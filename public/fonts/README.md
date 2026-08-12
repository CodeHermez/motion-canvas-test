# Vendored fonts

`space-grotesk-latin.woff2` — Space Grotesk, latin subset, variable (300–700).

Copyright 2020 The Space Grotesk Project Authors,
<https://github.com/floriankarsten/space-grotesk>.
Licensed under the SIL Open Font License 1.1 — full text in `OFL.txt`.

It is committed rather than fetched from `fonts.gstatic.com` at render time on
purpose: `fillText()` falls back to a system font if the face has not loaded and
raises no error, so a network hiccup during a render produces a full run of
wrong-but-plausible frames. A vendored file makes renders deterministic and
offline-capable.
