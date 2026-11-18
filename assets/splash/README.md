# Shared startup animation

Source: supplied 9 lego-fuse-top-right-synced.zip, index.html (6.2 seconds).
The animation stylesheet and behavior are preserved. The six embedded image
payloads now come from the separately supplied frame1.svg through frame6.svg,
stored byte-for-byte in frames/. Run scripts/build-splash-frames.mjs to re-embed
them without changing the surrounding HTML. The measured-path fuse script is retained:
stroke and spark share progress from 4030ms to 4898ms. Only demo Replay controls
and their event handler are removed. The completion bridge reports root bounce
completion to the same-origin parent; reduced motion shows the final frame.

frames/frame1.svg is also the current mobile icon source. Editor metadata is
removed only in derived icons; original paths/styles are preserved. Generated mobile icons scale the
artwork to 76.5% around its center (90% of the previous head size), leaving the opaque white adaptive background
at full size. The mobile animation keeps its previous 85% framing with a further 10% size
increase to improve the Android native-icon handoff. Desktop
icons retain the separately supplied Asset 2.png artwork. Previous icon assets
remain available for older installations.
See scripts/README-pwa.md for generation and startup integration.
