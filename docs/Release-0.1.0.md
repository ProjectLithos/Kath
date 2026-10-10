# Inu / Kath 0.1.0

This milestone completes the signed integer primitive block from the authoritative TODO.

- `sbyte`, `short`, `int`, and `long` now expose the completed freestanding parsing/formatting interfaces targeted by Inu.
- Parsing supports string and span input, signs, surrounding whitespace, exact min/max boundaries, format failures, and overflow failures.
- Formatting covers general, decimal precision, hexadecimal precision, provider overloads, and span formatting.
- Checked and unchecked conversion behaviour is covered by both host reference tests and the in-kernel conformance gate.
- Typed/boxed comparison, equality, hash behaviour, and canonical MinValue/MaxValue constants are covered for all four signed widths.
- `TODO.md` remains authoritative at the release ZIP root and marks the signed integer block complete.
