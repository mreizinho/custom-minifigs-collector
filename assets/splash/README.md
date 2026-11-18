# Shared startup animation

Source: supplied 9 lego-fuse-top-right-synced.zip, index.html (6.2 seconds).
The SVG and original animation stylesheet are preserved verbatim, including
the six embedded SVG frames. The supplied measured-path fuse script is retained:
stroke and spark share progress from 4030ms to 4898ms. Only demo Replay controls
and their event handler are removed. The completion bridge reports root bounce
completion to the same-origin parent; reduced motion shows the final frame.

f1.svg is the separately supplied mobile icon source. Editor metadata was
removed; original paths/styles are preserved. Generated mobile icons scale the
artwork to 85% around its center, leaving the opaque white adaptive background
at full size. The mobile animation sizing matches this new framing. Desktop
icons retain splash2.svg; previous frame1 assets remain for older installations.
See scripts/README-pwa.md for generation and startup integration.
