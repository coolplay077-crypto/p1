"""Shared matplotlib styling (light surface, hairline grid, fixed categorical order)."""
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

SURFACE = "#fcfcfb"
INK = "#0b0b0b"
INK2 = "#52514e"
MUTED = "#898781"
GRID = "#e1e0d9"
AXIS = "#c3c2b7"
# categorical slots, fixed order (validated palette)
C = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"]

plt.rcParams.update({
    "figure.facecolor": SURFACE, "axes.facecolor": SURFACE, "savefig.facecolor": SURFACE,
    "axes.edgecolor": AXIS, "axes.labelcolor": INK, "text.color": INK,
    "xtick.color": INK2, "ytick.color": INK2, "axes.grid": True, "grid.color": GRID,
    "grid.linewidth": 0.6, "grid.linestyle": "-", "axes.spines.top": False,
    "axes.spines.right": False, "font.family": "DejaVu Sans", "font.size": 9,
    "axes.titlesize": 10, "axes.titleweight": "bold", "axes.titlelocation": "left",
    "legend.frameon": False, "legend.fontsize": 8, "lines.linewidth": 1.2,
    "lines.solid_capstyle": "round", "axes.axisbelow": True,
})


def save(fig, path):
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


def hline_label(ax, y, text, x=None, color=MUTED):
    ax.axhline(y, color=color, lw=0.9)
    xl = ax.get_xlim()
    ax.text(x if x is not None else xl[0], y, " " + text, va="bottom", ha="left",
            color=INK2, fontsize=8)
