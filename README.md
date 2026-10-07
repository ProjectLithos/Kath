# Kath

**Kath is the graphical IDE for Kath&Inu: you describe the operating system you want, Kath assembles it from [Inu](../Inu/README.md)'s source components, and then lets you build, run, debug and inspect it, all in one place.**

Kath is a Windows desktop application built on **Eclipse Theia** and **Electron**. It is a full code editor (Monaco, file explorer, terminal, search, tasks, debugging) with an operating-system composition and engineering layer added on top by the `kath` extension package.

Current version: **0.0.88** (see `VERSION`)

---

## Contents

1. [Purpose](#purpose)
2. [How it works](#how-it-works)
3. [What you can configure](#what-you-can-configure)
4. [Requirements](#requirements)
5. [Building and launching](#building-and-launching)
6. [Using Kath](#using-kath)
7. [The engineering tools](#the-engineering-tools)
8. [Your generated OS project](#your-generated-os-project)
9. [Repository layout](#repository-layout)
10. [Architecture of the extension](#architecture-of-the-extension)
11. [Configuration and environment variables](#configuration-and-environment-variables)
12. [Developing Kath itself](#developing-kath-itself)
13. [Troubleshooting](#troubleshooting)
14. [Licensing](#licensing)

---

## Purpose

Kath exists so that a coder can create an operating system from a **very small, working foundation** instead of from a blank file.

- Kath **asks only the architectural questions that matter** (what kind of kernel, which executable formats, which startup model, which hardware).
- **Inu supplies the implementation**: working C# source for every selected capability.
- The generated source becomes **part of your OS**. It is copied into your project, belongs to you, and is never silently regenerated over your edits.

Kath does not decide your operating system's design for you. Choices that currently have only one supported answer (x64, UEFI) are still shown explicitly and recorded in the project, so more options can be added without redesigning the project model.

## How it works

```text
OS identity → Architecture → Boot method → Kernel model → Executable model
   → Startup / UI model → Hardware & driver support → Generate source → Build → Boot and run
```

1. **You choose.** The configurator ("Inu: Create Operating System") walks through the choices above.
2. **Kath resolves dependencies.** If you select USB keyboards, Kath works out that USB core, xHCI, HID, interrupts and PCI are needed. You select capabilities, not implementation dependencies.
3. **Kath copies source.** The selected Inu components (C#) are copied into your OS project's tree, together with generated boot, kernel, startup and shell scaffolding.
4. **You edit.** The OS-owned folders are yours to change in the integrated editor.
5. **Build / Run / Debug.** Kath invokes the Inu SDK (`Build-Inu.ps1`), which compiles with .NET NativeAOT, assembles a UEFI disk image and boots it under QEMU. Output and traces stream back into the IDE.

The generated kernel discovers hardware at runtime (CPU features, ACPI, memory, PCI and other devices) and uses whatever is in the intersection of *what your OS can drive* and *what the machine provides*, so you are not asked to predict the machine in advance.

## What you can configure

Kath's project definition (`schemaVersion` 9) records the architectural intent explicitly.

| Setting | Options |
|---|---|
| **OS identity** | Name, author, save location, optional logo (a simple uncompressed BMP, 24- or 32-bit) |
| **Target architecture** | **x64** (the only supported choice today) |
| **Boot method** | **UEFI** (the only supported choice today) |
| **Kernel model** | Monolithic, Microkernel, Hybrid, Custom. This changes the generated structure; it is not just a label. |
| **Custom placement** | For a Custom kernel, which selected post-boot mechanisms run in the kernel and which in userland (the communication, process and syscall substrate always stays kernel-resident so areas can talk to each other) |
| **Executable formats** | ELF64, PE64, flat binary, custom |
| **Startup / UI model** | None, CLI, GUI, CLI + GUI, custom |
| **Hardware support** | Storage controllers, USB, networking, graphics, input, audio, and so on |
| **Derived settings** | Memory system, scheduler, process support, syscall model, SMP and CPU roles, interrupt model, timers, filesystem (FatFs / FAT32), network stack (IPv4 / dual-stack), shell, GUI desktop, debugging and testing options, safety profile. Kath derives these from your primary choices rather than asking you for each one. |

> The protocol also reserves values such as `arm64`, `riscv64`, `multiboot2` and `direct`. Only **x64 + UEFI** is a supported build path at present.

You can change your mind later: **Reconfigure Inu OS** (right-click the OS root, or the Inu menu) re-applies a new architecture to an existing project.

## Requirements

| Requirement | Detail |
|---|---|
| OS | Windows x64 |
| Shell | PowerShell 5.1 or newer |
| Disk and network | Several GB free; internet for first-time tool downloads |
| Inu toolchain | .NET SDK 10.0.302, NativeAOT ILCompiler 10.0.10, LLVM 22.1.6, plus QEMU ≥ 11, OVMF firmware and NASM ≥ 2.16 for running images. See the [Inu README](../Inu/README.md#requirements). |
| Kath toolchain | Pinned and **provisioned automatically** by `Kath\Build-Kath.ps1` (see below) |

Kath's own pinned tools (`Kath\JSON\Toolchain-Versions.json`):

| Tool | Version | How it is obtained |
|---|---|---|
| Node.js | 22.22.0 | Downloaded and checksum-verified into `Kath\.toolchain\Node` |
| Python | 3.13.15 | Private copy from the official NuGet build package into `Kath\.toolchain\Python` |
| Visual Studio Build Tools | 18 (C++ workload, x86/x64 tools; Spectre libraries optional) | Installed machine-wide if missing. **Windows may show an elevation prompt.** |
| Eclipse Theia | 1.74.1 | npm, via `Kath\JSON\package.json` |
| Electron | 42.3.0 | npm (pinned because Theia 1.74.1 requires this exact Electron) |

These are needed because Theia's native Node modules are compiled during the install.

## Building and launching

Kath is built together with Inu from the **Kath&Inu root** (conventionally `C:\KandI`).

```bat
:: 1. One-time, explicit: install the private Inu toolchain
C:\KandI\Inu\Install-Toolchain.bat

:: 2. Build Inu and Kath
C:\KandI\Build.bat

:: 3. Launch Kath
C:\KandI\Run-Kath.bat
```

`Build.bat` accepts a FullSource ZIP explicitly (`Build.bat "Kath&Inu-FullSource-0.0.83.zip"`), otherwise it uses the newest `Kath&Inu-FullSource-x.y.z.zip` it finds in Downloads or the root if that is newer than the extracted source. `-ForceRebuild` bypasses stage caches.

What `Kath\Build-Kath.ps1` does:

1. Runs `Scripts\Install-KathToolchain.ps1` to ensure Node.js, Python and the MSVC build tools.
2. Stages a private npm workspace under `.toolchain\NpmWorkspace` (junctions for `applications`, `packages`, `CJS`, and `node_modules`), using `JSON\package.json` and, if present, `JSON\package-lock.json`.
3. Runs the cached build stages via `CJS\stage-cache.cjs`: npm dependencies, the `kath` extension, and the Theia/Electron application. Stages are skipped when their inputs have not changed.
4. Verifies the outputs exist (`packages\kath\lib\browser\inu-frontend-module.js`, `packages\kath\lib\node\inu-backend-module.js`, `applications\electron\lib\backend\electron-main.js`).
5. Publishes the small .NET launcher (`src\Kath.Launcher`) to `Bin\Kath.exe` and verifies its version equals `VERSION`.

Running Kath: `Run-Kath.bat` (root) starts `Kath\Bin\Kath.exe`, which locates the Kath directory and runs `Kath\Run-Kath.bat`. That script sets `KATH_ROOT` and `INU_SDK_ROOT`, puts the private Node and Python on `PATH`, and starts the Electron app through `npm run start --workspace @kath/electron`. If anything is missing it prints "has not been built completely" and tells you to run the root `Build.bat`.

> **A successful root build publishes to GitHub.** After a good build, `Build.ps1` runs `Kath\Publish-GitHub.ps1`, which commits and pushes this source tree to `https://github.com/ProjectLithos/Kath.git` (Inu goes to `ProjectLithos/Inu`). This requires `git` and push access. If you are working on a fork or just experimenting, edit the `$RepositoryUrl` in the `Publish-GitHub.ps1` scripts or remove that step from `Build.ps1` first.

Generated output (`lib`, `src-gen`, `node_modules`, `.toolchain`, `Bin`, `Artifacts`) is not source; the build recreates or preserves it as appropriate.

## Using Kath

### Create an operating system

1. Start Kath with `Run-Kath.bat`.
2. Run **Inu: Create Operating System** from the Command Palette (the configurator also opens from the Inu menu).
3. Enter the OS name (and optionally author and logo), choose a parent folder, then work through architecture, boot method, kernel model, executable formats, startup model and hardware support.
4. Confirm. Kath generates the source ("Generating the OS…") and opens the new project as your workspace.

Each OS you create gets its own registry entry and a numbered instance folder (for example `MyOs1`), so creating several OSes with the same name never collides. The registry lives at `%USERPROFILE%\.kath\operating-systems.json` (override with `KATH_STATE_ROOT`). Deleting or forgetting an OS always resolves from its registry ID, never from a folder scan or display name.

### Build, run and debug

From the **Go** menu, the toolbar, or the Command Palette:

| Command | What it does |
|---|---|
| **Build Inu OS** | Compiles your OS without booting it. Progress appears in the Output pane; full stage logs are retained under the SDK's `Artifacts\BuildLogs`. |
| **Run Inu OS** | Builds, creates a UEFI disk image, and boots it in QEMU. |
| **Debug Inu OS** | Boots under the debugger with breakpoints, stepping, register and memory inspection. |
| **Reconfigure Inu OS** | Re-applies a changed architecture to the existing project. |

Debugging supports toggling breakpoints (including **conditions** and **hit counts**), exception breakpoints, continue/pause/step-into/step-over/step-out/restart/stop, disassembly, expression evaluation, call frames, registers, memory reads, page-table inspection, and heap snapshots. Crash dumps (defined by `Inu.CrashDump.schema.json`) can be opened and examined.

### Edit your OS

Use Kath as you would any code editor. Know which files are yours:

- **Yours to edit:** `Boot\<OSName>`, `Kernel\<OSName>`, `Userland\<OSName>` (including `Kernel.cs`, `Boot.cs`, `Shell.cs`), your own `KernelProjects`, `Userland` projects and `Tests`.
- **SDK-provided:** `Provided` folders and the copied `Sdk` tree. These are hidden from the normal workspace explorer and may be refreshed by an SDK update. Anything you want to keep should live in the OS-named folders.

## The engineering tools

Everything below is under the **Inu** menu or the Command Palette. Most are enabled once an OS project is open.

**Architecture and composition**

| Tool | Purpose |
|---|---|
| **OS Architecture** | Visual model of the OS you have composed |
| **Component Library** | Browse every Inu component that can be selected |
| **Component Inspector** | Inspect a component's definition and dependencies |

**Run-time and analysis**

| Tool | Purpose |
|---|---|
| **OS Dashboard** | Overview of the project and its state |
| **Kernel Console** | The running kernel's console output |
| **Hardware / Device Tree** | Discovered devices, including those with no driver |
| **Tracing / Boot Analyser** | Boot stages and categorised trace events (boot, interrupt, syscall, scheduler, driver, memory, storage, network, graphics) |
| **Performance Profiler** | Function, per-CPU and counter profiling |

**Engineering**

| Tool | Purpose |
|---|---|
| **Driver Development Centre** | Scaffold PCI, USB, VirtIO and platform drivers and manage driver manifests and capabilities |
| **Target Manager** | Manage build/run targets |
| **OS-specific Static Analyzers** | Analysis aware of Inu's architectural boundaries |
| **Binary / Symbol Explorer** | Examine built binaries and symbols |
| **Memory-map Visualiser** | See the memory layout |
| **Interrupt / APIC Visualiser** | See interrupt routing |
| **Syscall Explorer** | Browse the system-call surface |
| **Image / Disk Explorer** | Inspect the generated disk image |
| **Physical-machine Debugger Transport** | Debug real hardware rather than the emulator |
| **SDK API** (Help menu) | The documented Inu SDK API |

## Your generated OS project

Roughly (exact contents depend on your choices):

```text
MyOs1/
├── InuProject.json        Project definition
├── Inu.ProjectGraph.json  Which generated projects exist and how they relate
├── InuKernel.csproj       Kernel project
├── Build-Kernel.bat       Build only
├── Run-Kernel.bat         Build and start QEMU
├── Boot/      Provided/  <OSName>/Boot.cs
├── Kernel/    Provided/  <OSName>/Kernel.cs
├── Userland/  Provided/  <OSName>/Shell.cs, Commands, Desktop, …
├── HAL/  Startup/
├── Sdk/                   Copied Inu components, compiled with NativeAOT as OS-owned source
├── KernelProjects/  Tests/
├── Assets/Logo.bmp        (if you chose a logo)
└── .theia/settings.json   Workspace settings written by Kath
```

If you chose a GUI startup model, the generated userland includes the desktop and login components. For a CLI model you get the editable shell, and command search paths are your policy to set (for example `FileSystemPaths.SetCommandsPaths(...)`).

`Build-Kernel.bat` and `Run-Kernel.bat` find the SDK through `INU_SDK_ROOT`; Kath sets this for you inside the IDE (to `<root>\Inu\SDK`). When running those wrappers from a plain shell, set it yourself.

## Repository layout

```text
Kath/
├── Build-Kath.bat/.ps1      Build Kath (toolchain, npm workspace, stages, launcher)
├── Run-Kath.bat             Start the IDE
├── Publish-GitHub.ps1       Publish this source tree after a successful build
├── VERSION                  Product version (must equal Inu\VERSION)
├── JSON/
│   ├── package.json         Workspace manifest: Theia 1.74.1, Electron 42.3.0, Node >=22 <23
│   ├── Toolchain-Versions.json  Pinned Node, Python and Visual Studio requirements
│   └── Security-Baseline.json   Dependency-audit policy and approved exceptions
├── CJS/                     Build helpers: stage cache, extension file lists, tests
├── Scripts/                 Install-KathToolchain.ps1, Manage-KathPackageLock.ps1, Resolve-KathVersion.ps1
├── applications/electron/   The Theia/Electron application (esbuild config, splash screen, icon)
├── packages/kath/           The Kath extension (see next section)
├── src/Kath.Launcher/       Small .NET launcher that becomes Bin\Kath.exe
└── docs/                    Design notes, the implementation specification, per-release notes
```

There is deliberately **no `Kath\SDK`**. Kath resolves the canonical SDK from the sibling `Inu\SDK`. Generated projects receive *copies* of the selected C# component source.

## Architecture of the extension

`packages\kath\src` follows Theia's three-way split:

| Folder | Runs in | Contents |
|---|---|---|
| `common/` | Both | `inu-protocol.ts`: the shared types and the `InuProjectService` RPC interface (project configuration, debug state, crash dumps, traces, profiler, drivers) |
| `node/` | Backend (Node) | Project generation and validation, the OS registry, build/run orchestration, debug and runtime-debug support, the disk-image service, and the environment (`KATH_ROOT`, `INU_SDK_ROOT`, `KATH_VERSION`) |
| `browser/` | Frontend (Electron renderer) | The commands and menus (`inu-contribution.ts`), the configurator, toolbar, application shell, breakpoint manager, and one widget per tool listed above |

The frontend talks to the backend only through the protocol, so project generation and process control never run in the renderer.

## Configuration and environment variables

| Variable | Used for | Default |
|---|---|---|
| `KATH_ROOT` | Kath directory | Derived from the extension location (set by `Run-Kath.bat`) |
| `INU_SDK_ROOT` | Inu SDK directory | `<Kath>\..\Inu\SDK` (set by the build and run scripts) |
| `KATH_STATE_ROOT` | Where the OS registry is stored | `%USERPROFILE%\.kath` |
| `INU_QEMU_X64`, `INU_OVMF_CODE`, `INU_OVMF_VARS` | QEMU and OVMF locations for runs and the test matrix | Discovered / none |

## Developing Kath itself

- Source lives in `packages\kath\src` (TypeScript/React widgets) and `applications\electron`.
- Always build through `Build.bat` (or `Kath\Build-Kath.bat` once the Inu toolchain is in place). The scripts set up the private Node, Python and npm workspace; running npm by hand outside them will not see the staged workspace.
- `Build-Kath.bat -ForceRebuild` invalidates all stage caches. Stage inputs are hashed, so unchanged stages are skipped.
- `JSON\package.json` pins Theia and Electron exactly. Upgrade them together; `Security-Baseline.json` records the audit policy and the reviewed exceptions (Electron and `extract-zip`, flagged for review after 2026-09-30).
- Generated JavaScript (`lib`, `src-gen`) is not source and is not committed or distributed.
- Kath and Inu versions must always match; bump `VERSION` in both (the root `Version.bat` validates and propagates it).

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `Kath has not been built` / `has not been built completely for the current source` | Run the root `Build.bat`, then `Run-Kath.bat`. |
| `Kath launcher/source version mismatch` | `Bin\Kath.exe` is stale relative to `VERSION`. Rebuild with the root `Build.bat`. |
| Build stops asking for the Inu toolchain | Run `Inu\Install-Toolchain.bat` once (Inu never installs its toolchain implicitly). |
| Windows prompts for elevation during the build | `Install-KathToolchain.ps1` is installing the Visual C++ Build Tools. This is expected on first run. |
| Native module compile errors during npm install | The MSVC C++ workload or the private Python is missing or damaged. Re-run the build; delete `.toolchain\Python` or `.toolchain\Node` to force re-provisioning. |
| Odd build output after switching versions | `Build.bat -ForceRebuild`. |
| Build succeeds, then GitHub publish fails | Missing `git` or push rights; see the note under [Building and launching](#building-and-launching). |
| Run/Debug cannot start QEMU | Install QEMU ≥ 11 and OVMF, and set `INU_QEMU_X64`, `INU_OVMF_CODE`, `INU_OVMF_VARS` if they are not auto-detected. |

## Licensing

The repository does not currently include a top-level `LICENSE` file; add one before redistributing. Kath builds on Eclipse Theia (EPL-2.0 and its dependencies), Electron and Monaco, each under their own licences. Inu's bundled third-party components are listed in `Inu\SDK\THIRD-PARTY-NOTICES.md`.
