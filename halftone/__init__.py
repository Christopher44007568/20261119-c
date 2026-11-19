"""Reproducible CMYK halftone color-separation experiment.

Modules
-------
config   : explicit experiment configuration (screens, inks, paper)
color    : linear RGB <-> CMYK rule, XYZ/Lab, CIEDE2000, Neugebauer model
screen   : rotated amplitude-modulated halftone screens (4 dot shapes)
target   : synthetic linear-RGB test target (ramp, fine lines, wedge, patches)
simulate : dot gain, misregistration, paper reflectance, composite print
metrics  : coverage accuracy, detail loss, mean color error in named ROIs
export   : 1-bit plates with physical metadata, zoom views, report figures
"""

__all__ = [
    "config",
    "color",
    "screen",
    "target",
    "simulate",
    "metrics",
    "export",
]
