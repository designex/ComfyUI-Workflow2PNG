/**
 * ComfyUI-Workflow2PNG
 * Export workflow canvas (nodes + connections) as PNG with transparent background.
 * Compatible with ComfyUI frontend >= 1.15.x (including 1.28.8).
 *
 * Single dynamic top-bar button:
 *   - No selection  → "导出PNG(全部)"  → export entire workflow
 *   - Has selection → "导出(已选择)"   → export selected nodes/groups only
 *
 * Right-click context menu:
 *   - Select nodes/groups, right-click on canvas/node, choose "导出选中为PNG"
 *   - Submenu offers 1X / 2X / 3X / 4X / 5X scale exports
 *
 * Settings → Workflow2PNG → export scale multiplier (1X–5X) for the top-bar button.
 */
import { app } from "../../scripts/app.js";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const SETTING_SCALE  = "Workflow2PNG.Scale";
const PADDING        = 100;         // px padding around exported area (wide enough for shadows/connectors)
const MAX_CANVAS_PX  = 16384;       // browser hard limit for canvas dimension

/* ------------------------------------------------------------------ */
/*  Bounding-box helpers                                               */
/* ------------------------------------------------------------------ */

function nodesBounds(nodes) {
    if (!nodes || nodes.length === 0) return null;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const n of nodes) {
        x1 = Math.min(x1, n.pos[0]);
        y1 = Math.min(y1, n.pos[1]);
        x2 = Math.max(x2, n.pos[0] + n.size[0]);
        y2 = Math.max(y2, n.pos[1] + n.size[1]);
    }
    return [x1, y1, x2 - x1, y2 - y1];
}

function groupsBounds(groups) {
    if (!groups || groups.length === 0) return null;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const g of groups) {
        x1 = Math.min(x1, g.pos[0]);
        y1 = Math.min(y1, g.pos[1]);
        x2 = Math.max(x2, g.pos[0] + g.size[0]);
        y2 = Math.max(y2, g.pos[1] + g.size[1]);
    }
    return [x1, y1, x2 - x1, y2 - y1];
}

function mergeRect(a, b) {
    if (!a) return b;
    if (!b) return a;
    const x1 = Math.min(a[0], b[0]);
    const y1 = Math.min(a[1], b[1]);
    const x2 = Math.max(a[0] + a[2], b[0] + b[2]);
    const y2 = Math.max(a[1] + a[3], b[1] + b[3]);
    return [x1, y1, x2 - x1, y2 - y1];
}

function padBounds(b) {
    return [b[0] - PADDING, b[1] - PADDING, b[2] + PADDING * 2, b[3] + PADDING * 2];
}

/**
 * Check whether the user has any nodes or groups selected.
 */
function hasSelection(canvas) {
    const sel = canvas.selected_nodes
        ? Object.values(canvas.selected_nodes)
        : [];
    const grp = canvas.selected_group || null;
    return sel.length > 0 || !!grp;
}

function getSelectionBounds(graph, canvas) {
    const sel = canvas.selected_nodes
        ? Object.values(canvas.selected_nodes)
        : [];
    const grp = canvas.selected_group || null;
    if (sel.length === 0 && !grp) return null;

    let bounds = nodesBounds(sel);
    if (grp) {
        bounds = mergeRect(bounds, [grp.pos[0], grp.pos[1], grp.size[0], grp.size[1]]);
    }
    return bounds;
}

function getFullBounds(graph) {
    return mergeRect(nodesBounds(graph._nodes), groupsBounds(graph._groups));
}

/* ------------------------------------------------------------------ */
/*  Toast helper                                                       */
/* ------------------------------------------------------------------ */

function toast(severity, summary, detail) {
    try {
        app.extensionManager.toast.add({ severity, summary, detail, life: 3000 });
    } catch (_) {
        console[severity === "error" ? "error" : "warn"](
            `[Workflow2PNG] ${summary}: ${detail}`
        );
    }
}

/* ------------------------------------------------------------------ */
/*  DOM widget capture (textareas / text inputs inside nodes)          */
/* ------------------------------------------------------------------ */

/**
 * Collect DOM-based widgets (textarea/text input) that overlap the
 * export bounds, converting their screen positions to graph-space.
 */
function captureDomWidgets(bounds) {
    const canvas     = app.canvas;
    const canvasRect = canvas.canvas.getBoundingClientRect();
    const widgets    = [];

    // In ComfyUI, DOM widgets live inside the graph container.
    const container = canvas.canvas.parentElement || document.body;
    const elements  = container.querySelectorAll(
        'textarea, input[type="text"], input[type="number"]'
    );

    for (const el of elements) {
        if (!el.offsetParent) continue;  // hidden
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;

        // screen → graph space (using current live viewport)
        const graphX = (rect.left - canvasRect.left) / canvas.ds.scale - canvas.ds.offset[0];
        const graphY = (rect.top  - canvasRect.top)  / canvas.ds.scale - canvas.ds.offset[1];
        const graphW = rect.width  / canvas.ds.scale;
        const graphH = rect.height / canvas.ds.scale;

        // overlap test with export bounds
        if (graphX + graphW < bounds[0] || graphX > bounds[0] + bounds[2] ||
            graphY + graphH < bounds[1] || graphY > bounds[1] + bounds[3]) {
            continue;
        }

        const style = window.getComputedStyle(el);

        // Use the inner content width (excluding padding/border) for wrapping.
        const padLeft   = parseFloat(style.paddingLeft)   || 0;
        const padRight  = parseFloat(style.paddingRight)  || 0;
        const borderLeft  = parseFloat(style.borderLeftWidth)  || 0;
        const borderRight = parseFloat(style.borderRightWidth) || 0;
        const hPad      = padLeft + padRight + borderLeft + borderRight;
        const contentW  = Math.max(0, rect.width - hPad);

        widgets.push({
            x            : graphX,
            y            : graphY,
            w            : graphW,
            h            : graphH,
            contentW     : contentW / canvas.ds.scale,
            text         : el.value || el.textContent || "",
            isTextarea   : el.tagName === "TEXTAREA",
            fontSize     : parseInt(style.fontSize) || 12,
            color        : style.color          || "#000000",
            bg           : style.backgroundColor || "#ffffff",
        });
    }
    return widgets;
}

/**
 * Word-based line wrapping for ComfyUI prompt textareas.
 * Splits on whitespace OR commas (keeps delimiters as tokens), so
 * comma-separated tags wrap individually.  A single tag that still
 * exceeds maxWidth is placed on its own line and allowed to overflow
 * rather than being split mid-word.
 */
function wrapLine(ctx, text, maxWidth) {
    if (!text) return [""];
    const words = text.split(/([\s,]+)/);  // keep spaces/commas as tokens
    const lines = [];
    let current = "";

    for (const token of words) {
        // delimiter tokens (spaces/commas): keep at end of line if they fit
        if (/^[\s,]*$/.test(token)) {
            if (current && ctx.measureText(current + token).width <= maxWidth) {
                current += token;
            }
            continue;
        }

        const test = current + token;
        if (ctx.measureText(test).width <= maxWidth) {
            current = test;
        } else {
            if (current.trim().length > 0) {
                lines.push(current.trimEnd());
            }
            // start a new line with this whole tag/word
            current = token;
        }
    }
    if (current.length > 0) {
        lines.push(current.trimEnd());
    }
    return lines.length ? lines : [""];
}

/**
 * Draw captured DOM widgets onto the export canvas.
 */
function drawDomWidgets(ctx, widgets, exportBounds, exportScale) {
    for (const w of widgets) {
        const cx = (w.x - exportBounds[0]) * exportScale;
        const cy = (w.y - exportBounds[1]) * exportScale;
        const cw = w.w * exportScale;
        const ch = w.h * exportScale;

        // Background
        ctx.fillStyle = (w.bg && w.bg !== "rgba(0, 0, 0, 0)") ? w.bg : "#ffffff";
        ctx.fillRect(cx, cy, cw, ch);

        // Border
        ctx.strokeStyle = "rgba(0,0,0,0.15)";
        ctx.lineWidth   = Math.max(1, exportScale);
        ctx.strokeRect(cx, cy, cw, ch);

        // Text
        ctx.fillStyle = w.color || "#000000";
        const fontSize = Math.max(8, w.fontSize * exportScale);
        ctx.font       = `${fontSize}px ${SYSTEM_FONT}`;
        ctx.textBaseline = "top";

        const padding = 2 * exportScale;
        const maxTextW  = (w.contentW || w.w) * exportScale - padding * 2;
        const rawLines  = w.text.split("\n");
        let ty          = cy + padding;
        const maxY      = cy + ch - padding;

        for (const rawLine of rawLines) {
            const wrapped = wrapLine(ctx, rawLine, maxTextW);
            for (const line of wrapped) {
                if (ty + fontSize > maxY) break;
                ctx.fillText(line, cx + padding, ty);
                ty += fontSize * 1.25;
            }
            if (ty + fontSize > maxY) break;
        }
    }
}

/**
 * Return the preferred UI font family based on the operating system.
 * Windows → Microsoft YaHei, macOS → PingFang SC.
 */
function getSystemFontFamily() {
    const ua       = navigator.userAgent.toLowerCase();
    const platform = (navigator.platform || "").toLowerCase();

    if (ua.includes("windows") || platform.includes("win32")) {
        return '"Microsoft YaHei", "微软雅黑", sans-serif';
    }
    if (ua.includes("mac") || platform.includes("macintel") || platform.includes("macppc")) {
        return '"PingFang SC", "Heiti SC", "Hiragino Sans GB", sans-serif';
    }
    return 'sans-serif';
}

const SYSTEM_FONT = getSystemFontFamily();

/* ------------------------------------------------------------------ */
/*  Core PNG export routine  (always transparent background)           */
/* ------------------------------------------------------------------ */

async function exportAsPNG(bounds, scale) {
    const graphCanvas = app.canvas;
    const graph       = app.graph || graphCanvas.graph;

    if (!graphCanvas || !graph) {
        toast("error", "导出失败", "无法访问画布");
        return;
    }
    if (!bounds) {
        toast("warn", "无内容", "画布上没有可导出的节点");
        return;
    }

    const padded = padBounds(bounds);

    /* -- compute export canvas size (clamped) ----------------------- */
    let exportScale = scale;
    let cw = Math.ceil(padded[2] * exportScale);
    let ch = Math.ceil(padded[3] * exportScale);
    if (Math.max(cw, ch) > MAX_CANVAS_PX) {
        exportScale = Math.max(1, Math.floor(MAX_CANVAS_PX / Math.max(padded[2], padded[3])));
        cw = Math.ceil(padded[2] * exportScale);
        ch = Math.ceil(padded[3] * exportScale);
        toast("info", "尺寸受限",
            `画布过大，已自动降至 ${exportScale}X (${cw}×${ch}px)`);
    }

    /* -- save original canvas state --------------------------------
     *  DragAndScale.offset is a Float32Array whose setter is buggy
     *  in some ComfyUI versions (1.28.x).  We MUST mutate elements
     *  in-place instead of replacing the whole array.               */
    const origW       = graphCanvas.canvas.width;
    const origH       = graphCanvas.canvas.height;
    const origOffset0 = graphCanvas.ds.offset[0];
    const origOffset1 = graphCanvas.ds.offset[1];
    const origScale   = graphCanvas.ds.scale;
    const orig   = {
        show_grid                : graphCanvas.show_grid,
        render_canvas_border     : graphCanvas.render_canvas_border,
        show_info                : graphCanvas.show_info,
        render_execution_order   : graphCanvas.render_execution_order,
        render_connections_bglow : graphCanvas.render_connections_bglow,
        render_only_selected     : graphCanvas.render_only_selected,
        clear_background         : graphCanvas.clear_background,
        background_color         : graphCanvas.background_color,
        background_image         : graphCanvas.background_image,
    };

    /* -- capture DOM widgets BEFORE we change the viewport -------- */
    const domWidgets = captureDomWidgets(padded);

    /* -- apply export viewport ------------------------------------- */
    graphCanvas.canvas.width  = cw;
    graphCanvas.canvas.height = ch;
    graphCanvas.ds.scale      = exportScale;
    graphCanvas.ds.offset[0]  = -padded[0];
    graphCanvas.ds.offset[1]  = -padded[1];

    graphCanvas.show_grid                = false;
    graphCanvas.render_canvas_border     = false;
    graphCanvas.show_info                = false;
    graphCanvas.render_execution_order   = false;
    graphCanvas.render_connections_bglow = false;
    graphCanvas.render_only_selected     = false;

    /* Force transparent background (alpha channel preserved) */
    graphCanvas.clear_background = false;
    graphCanvas.background_image = null;

    /* -- render ---------------------------------------------------- */
    graphCanvas.draw(true, true);

    /* -- draw DOM widgets onto the canvas -------------------------- */
    if (domWidgets.length > 0) {
        const ctx = graphCanvas.canvas.getContext("2d");
        drawDomWidgets(ctx, domWidgets, padded, exportScale);
    }

    /* -- capture --------------------------------------------------- */
    const blob = await new Promise((resolve) =>
        graphCanvas.canvas.toBlob(resolve, "image/png")
    );

    /* -- restore original state ------------------------------------ */
    graphCanvas.canvas.width  = origW;
    graphCanvas.canvas.height = origH;
    graphCanvas.ds.scale      = origScale;
    graphCanvas.ds.offset[0]  = origOffset0;
    graphCanvas.ds.offset[1]  = origOffset1;

    graphCanvas.show_grid                = orig.show_grid;
    graphCanvas.render_canvas_border     = orig.render_canvas_border;
    graphCanvas.show_info                = orig.show_info;
    graphCanvas.render_execution_order   = orig.render_execution_order;
    graphCanvas.render_connections_bglow = orig.render_connections_bglow;
    graphCanvas.render_only_selected     = orig.render_only_selected;
    graphCanvas.clear_background         = orig.clear_background;
    graphCanvas.background_color         = orig.background_color;
    graphCanvas.background_image         = orig.background_image;

    graphCanvas.draw(true, true);

    /* -- download -------------------------------------------------- */
    if (!blob) { toast("error", "导出失败", "无法生成 PNG"); return; }

    const ts = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
    const filename = `workflow_${ts}.png`;
    const url  = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href     = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    toast("success", "导出成功", `${filename} (${cw}×${ch}px, ${exportScale}X, 透明背景)`);
}

/* ------------------------------------------------------------------ */
/*  Export selected nodes/groups via context menu                      */
/* ------------------------------------------------------------------ */

async function exportSelectedAsPNG(scale, includeNode) {
    const graph  = app.graph || app.canvas.graph;
    const canvas = app.canvas;

    let bounds = getSelectionBounds(graph, canvas);
    if (includeNode) {
        bounds = mergeRect(bounds, nodesBounds([includeNode]));
    }
    if (!bounds) {
        toast("warn", "无选中内容", "请先选中一个或多个节点/组");
        return;
    }
    await exportAsPNG(bounds, scale);
}

/**
 * Build the "Export selected as PNG" context-menu entry with 1X–5X submenu.
 */
function makeExportMenuEntry(node) {
    return {
        content      : "导出选中为PNG",
        has_submenu  : true,
        submenu      : {
            options: [1, 2, 3, 4, 5].map((scale) => ({
                content: `${scale}X`,
                callback() {
                    exportSelectedAsPNG(scale, node);
                },
            })),
        },
    };
}

/**
 * Wrap an existing LiteGraph menu-options factory so our export entry is
 * appended just before the "Remove" option, or at the end if not found.
 */
function injectExportMenuItem(originalFn, node) {
    return function (...args) {
        const options = (typeof originalFn === "function" && originalFn.apply(this, args)) || [];

        // Avoid duplicate injection if this function is called multiple times.
        if (options.some((opt) => opt && opt._w2pExport)) return options;

        const entry = makeExportMenuEntry(node ? args[0] : undefined);
        entry._w2pExport = true;

        // Try to insert before Remove/Delete entries for a natural position.
        const removeIdx = options.findIndex(
            (opt) => opt && /^(remove|delete|删除)$/i.test(String(opt.content))
        );
        if (removeIdx >= 0) {
            options.splice(removeIdx, 0, null, entry);
        } else {
            options.push(null, entry);
        }
        return options;
    };
}

/**
 * Attach the export item to LiteGraph canvas/node/group context menus.
 * Works on the prototype so it covers both canvas background and node clicks.
 */
function installContextMenu() {
    try {
        const LGC = window.LGraphCanvas || app.canvas?.constructor;
        if (!LGC || !LGC.prototype) return;

        const proto = LGC.prototype;

        if (proto.getCanvasMenuOptions && !proto.getCanvasMenuOptions._w2pWrapped) {
            proto.getCanvasMenuOptions = injectExportMenuItem(proto.getCanvasMenuOptions, false);
            proto.getCanvasMenuOptions._w2pWrapped = true;
        }
        if (proto.getMenuOptions && !proto.getMenuOptions._w2pWrapped) {
            proto.getMenuOptions = injectExportMenuItem(proto.getMenuOptions, true);
            proto.getMenuOptions._w2pWrapped = true;
        }
        if (proto.getGroupMenuOptions && !proto.getGroupMenuOptions._w2pWrapped) {
            proto.getGroupMenuOptions = injectExportMenuItem(proto.getGroupMenuOptions, false);
            proto.getGroupMenuOptions._w2pWrapped = true;
        }

        console.log("[Workflow2PNG] Context menu entries installed.");
    } catch (e) {
        console.warn("[Workflow2PNG] Could not install context menu:", e);
    }
}

/* ------------------------------------------------------------------ */
/*  DOM injection — single dynamic button (compatible with 1.28.8)    */
/* ------------------------------------------------------------------ */

function findMenuContainer() {
    const selectors = [
        ".comfyui-menu.top",
        "nav.comfyui-menu",
        ".comfyui-menu",
        ".side-bar-panel",
        ".comfy-menu",
        ".comfyui-topbar",
    ];
    for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) return el;
    }
    return null;
}

/* ------------------------------------------------------------------ */
/*  Extension registration                                             */
/* ------------------------------------------------------------------ */

app.registerExtension({
    name: "ComfyUI.Workflow2PNG",

    /* -- settings -------------------------------------------------- */
    settings: [
        {
            id           : SETTING_SCALE,
            name         : "Workflow2PNG — 导出倍数",
            tooltip      : "导出 PNG 时画布缩放倍数（1X–5X）。倍数越高图像越清晰、文件越大。注意：浏览器 Canvas 单边的硬上限为 16384px，若导出宽或高超过该值会自动降级到 1X–5X 内能容纳的最大倍数。",
            type         : "combo",
            options      : ["1X", "2X", "3X", "4X", "5X"],
            defaultValue : "1X",
        },
    ],

    /* -- setup: inject dynamic button into ComfyUI top bar --------- */
    async setup() {
        let btnEl = null;   // reference to the injected <button>

        const getScale = () => {
            const raw = app.extensionManager.setting.get(SETTING_SCALE);
            return parseInt(raw) || 1;
        };

        /** Update button label + tooltip based on current selection. */
        const syncButton = () => {
            if (!btnEl) return;
            const selected = hasSelection(app.canvas);
            const labelEl  = btnEl.querySelector(".comfy-w2p-label");
            if (selected) {
                btnEl.title = "将当前选中的节点/组导出为 PNG（透明背景）";
                if (labelEl) labelEl.textContent = "导出(已选择)";
            } else {
                btnEl.title = "将整个工作流（所有节点和连线）导出为 PNG（透明背景）";
                if (labelEl) labelEl.textContent = "导出PNG(全部)";
            }
        };

        /** The single click handler — decides export scope at click time. */
        const handleClick = async () => {
            const canvas = app.canvas;
            const graph  = app.graph || canvas.graph;
            const selected = hasSelection(canvas);

            const bounds = selected
                ? getSelectionBounds(graph, canvas)
                : getFullBounds(graph);

            if (!bounds) {
                toast("warn", selected ? "无选中内容" : "空画布",
                    selected ? "请先选中一个或多个节点/组" : "工作流中没有任何节点");
                return;
            }

            await exportAsPNG(bounds, getScale());
        };

        /* ---- inject into menu bar ---- */
        const tryInject = () => {
            const container = findMenuContainer();
            if (!container) return false;

            /* divider */
            const sep = document.createElement("span");
            sep.style.cssText =
                "width:1px;height:18px;background:rgba(255,255,255,0.12);" +
                "margin:0 4px;display:inline-block;vertical-align:middle;";
            container.appendChild(sep);

            /* the single button */
            btnEl = document.createElement("button");
            btnEl.className = "comfyui-button comfy-w2p-btn";
            btnEl.innerHTML =
                '<span class="comfy-w2p-icon">🖼️</span>' +
                '<span class="comfy-w2p-label">导出PNG(全部)</span>';

            Object.assign(btnEl.style, {
                display      : "inline-flex",
                alignItems   : "center",
                gap          : "6px",
                padding      : "4px 10px",
                margin       : "0 3px",
                border       : "1px solid rgba(255,255,255,0.1)",
                borderRadius : "6px",
                background   : "rgba(0,0,0,0.65)",
                color        : "#ffffff",
                fontSize     : "13px",
                fontWeight   : "500",
                lineHeight   : "20px",
                cursor       : "pointer",
                whiteSpace   : "nowrap",
                fontFamily   : "inherit",
                boxShadow    : "0 1px 2px rgba(0,0,0,0.2)",
            });

            btnEl.addEventListener("mouseenter", () => {
                btnEl.style.background = "rgba(0,0,0,0.85)";
            });
            btnEl.addEventListener("mouseleave", () => {
                btnEl.style.background = "rgba(0,0,0,0.65)";
            });
            btnEl.addEventListener("click", async () => {
                btnEl.disabled = true;
                btnEl.style.opacity = "0.6";
                try {
                    await handleClick();
                } catch (e) {
                    console.error("[Workflow2PNG]", e);
                    toast("error", "导出异常", e.message);
                } finally {
                    btnEl.disabled = false;
                    btnEl.style.opacity = "1";
                }
            });

            container.appendChild(btnEl);
            syncButton();  // initial label
            console.log("[Workflow2PNG] Button injected into:",
                container.className || container.tagName);
            return true;
        };

        if (!tryInject()) {
            setTimeout(() => {
                if (!tryInject()) {
                    console.warn("[Workflow2PNG] Could not find menu container.");
                }
            }, 800);
        }

        /* ---- install right-click context menu (1X–5X for selection) ---- */
        installContextMenu();

        /* ---- selection tracking via canvas callback + polling ---- */
        const syncLabel = () => {
            if (!btnEl) return;
            const labelEl  = btnEl.querySelector(".comfy-w2p-label");
            const selected = hasSelection(app.canvas);
            if (selected) {
                btnEl.title = "将当前选中的节点/组导出为 PNG（透明背景）";
                if (labelEl) labelEl.textContent = "导出(已选择)";
            } else {
                btnEl.title = "将整个工作流导出为 PNG（透明背景）";
                if (labelEl) labelEl.textContent = "导出PNG(全部)";
            }
        };

        /* Hook into LiteGraph's native selection change callback */
        try {
            const origSelCb = app.canvas.onSelectionChange;
            app.canvas.onSelectionChange = function (...args) {
                if (typeof origSelCb === "function") origSelCb.apply(this, args);
                syncLabel();
            };
        } catch (_) { /* ignore if not available */ }

        /* Fallback: poll every 300 ms in case the callback is not fired */
        setInterval(syncLabel, 300);
    },
});
