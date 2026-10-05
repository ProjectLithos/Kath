# Kath

Kath is the graphical IDE product shipped with Inu. The current implementation is derived from the full Electron/Theia IDE source and is built from this directory.

Normal use from the Kath&Inu root:

```bat
C:\KandI\Build.bat
C:\KandI\Run-Kath.bat
```

Generated output (`lib`, `src-gen`, `node_modules`, `.toolchain`, `Bin`, and `Artifacts`) is not source and is recreated or preserved by the build as appropriate.

`Kath\SDK` has been removed. Kath resolves the canonical source SDK from `C:\KandI\Inu\SDK`. Generated OS projects receive copies of the selected C# SDK component source and compile those copies with NativeAOT as OS-owned source.
