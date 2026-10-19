## 0.1.124 incremental GitHub backlog publishing

- [x] Discover the current GitHub `origin/main` commit before publishing and verify it is an ancestor of local HEAD; never force-push or rewrite independent remote history.
- [x] Push only commits that GitHub is missing, in ordered fast-forward batches of 25 commits by default, so a multi-gigabyte Inu backlog is not packed into one push.
- [x] Automatically halve a failed batch and retry the same unpublished range until it succeeds or a single commit is isolated as the failing unit.
- [x] Preserve every successful earlier batch when a later batch fails, and report exact published/missing commit progress.
- [x] Allow `INU_GITHUB_PUSH_BATCH_SIZE` to override the default batch size from 1 to 1000 commits without changing source.
- [x] Keep the five-minute Git HTTPS zero-progress guard, non-interactive authentication, final HEAD verification and upstream tracking.
- [x] Preserve the authoritative root TODO.md and Kath/TODO.md byte-identical mirror.

## 0.1.123 ProjectCreator drive-policy migration compile fix

- [x] Fix the unescaped `/Drives/Drive` string literal in `RepairStockTestOsNonDestructiveStoragePolicy` that caused CS1003 at `Program.cs:627`.
- [x] Audit the complete 0.1.122 ProjectCreator drive-management/materialisation block for adjacent malformed string literals.
- [x] Preserve all DRIVES/DRIVENAME/PARTITION/FORMAT commands and matching help unchanged.
- [x] Preserve the authoritative root TODO.md and Kath/TODO.md byte-identical mirror.

## 0.1.122 ring-3 drive management commands

- [x] Add DRIVES to list only additional data drives with controller kind, capacity, partition count, read-only state and logical name.
- [x] Add DRIVENAME to assign a validated user-friendly logical name to a data drive.
- [x] Add PARTITION to create an equal-sized GPT layout on a blank drive and require explicit `--replace --yes` before destructive repartitioning.
- [x] Add FORMAT to format a selected unmounted data-drive partition as FAT32 with explicit `--yes` confirmation.
- [x] Keep the boot/system drive outside the user-manageable drive ordinal space so the stock commands cannot partition or format the running system disk.
- [x] Expose drive-management operations through the existing Get/Set/Event syscall model; no new syscall class or numeric side channel.
- [x] Add matching MAN help for every new command and let ProjectCreator materialise the canonical command source into existing OS projects only when it is missing.
- [x] Preserve the authoritative root TODO.md and Kath/TODO.md byte-identical mirror.

## 0.1.121 non-destructive storage discovery + real drive namespace
- [x] Stop `Inu.ImageBuilder` from pre-creating fake `/Drives/DriveN/Partition1/Partition2` directories before hardware discovery.
- [x] Keep the system/boot drive mounted only at `/`; `/Drives` now contains only additional physical drives, numbered densely from `Drive0`.
- [x] Remove the stock Test OS policy that automatically created two GPT/FAT32 partitions on every blank NVMe/AHCI disk; partitioning and formatting are explicit OS-author choices.
- [x] Preserve and mount existing additional-drive filesystems without destructive repartitioning.
- [x] Safely reset legacy auto-provisioned Test OS data disks only when the previous image manifest proves the old two-partition policy created them and both FAT32 roots are still empty; never erase a disk containing files.
- [x] Migrate existing untouched stock Test OS `Kernel.cs` storage policy automatically while preserving coder-modified storage policy byte-for-byte.
- [x] Keep the authoritative root `TODO.md` mirrored byte-for-byte into `Kath/TODO.md`.

## 0.1.120 state-aware stale QEMU session cleanup
- [x] Query the previous accepted QEMU session through its recorded QMP port instead of treating any live PID as an active guest.
- [x] Automatically stop and clear `Inu.Run.json` when the previous `-no-shutdown` QEMU process is alive but QMP reports a non-running state such as `guest-panicked`.
- [x] Clear stale metadata when the previous QEMU PID has exited, the manifest is invalid, or the PID has been reused by a different executable.
- [x] Preserve persistent FAT32 image ownership safety by blocking a new launch only when QMP confirms the previous guest is genuinely `running`.
- [x] Keep the authoritative root `TODO.md` mirrored byte-for-byte into `Kath/TODO.md`.

## 0.1.119 NVMe guest-panic fix + reliable GitHub publishing + Kath TODO mirror
- [x] Keep the current polling NVMe implementation explicitly synchronous; do not request MSI/MSI-X while `WaitCompletion()` still polls completion queues.
- [x] Remove the invalid NVMe `INTMC` interrupt-mask-clear write that QEMU rejects when MSI-X is enabled.
- [x] Add per-controller NVMe startup diagnostics for mode, state, queue sizes, namespace count and version.
- [x] Add automated QEMU stop-state diagnosis for the NVMe INTMC/MSI-X fault and rejected interrupt-vector-0 evidence.
- [x] Copy the authoritative root `TODO.md` into `Kath/TODO.md` on every source bootstrap/install and verify the mirror by SHA-256.
- [x] Remove the 90/120-second GitHub publication kill timers; allow large Inu pushes to finish while retaining a five-minute Git HTTPS zero-progress guard.
- [x] Preserve non-interactive Git authentication and never force-push remote history.

## 0.1.118 xHCI Native diagnostic compile fix
- [x] Import `Inu.Kernel.Internal.X64` in `KernelXhci.cs` and `KernelXhci.RingsAndEvents.cs` so the 0.1.117 `Native.WritePort8` diagnostics compile.
- [x] Audit every `Native.*` reference under `Inu.Usb.Xhci`; every calling partial now imports the shared x64 low-level interop namespace.
- [x] Preserve the 0.1.117 stale-EINT acknowledgement repair, HID interrupt-loss watchdog, and deep xHCI transfer/event diagnostics unchanged.

## 0.1.117 xHCI event-interrupt acknowledgement and keyboard completion diagnostics
- [x] Clear stale xHCI `USBSTS.EINT` and `IMAN.IP` after synchronous bootstrap event draining before enabling runtime interrupt delivery.
- [x] Acknowledge both xHCI event-interrupt latches after every runtime interrupt instead of clearing only `IMAN.IP`.
- [x] Add xHCI interrupt-state snapshots before/after bootstrap drain and before/after runtime interrupt enable.
- [x] Add per-keyboard-TD snapshots around the endpoint doorbell and completion/timeout boundary.
- [x] Add event-TRB diagnostics with type, completion code, slot, DCI and residual length.
- [x] Add a bounded 10 ms interrupt-loss watchdog while a synchronous HID request is outstanding; normal completion remains interrupt-driven, but a latched event can be recovered if MSI/MSI-X notification is lost.
- [x] Expand final Kath/QEMU breadcrumb legends so post-interactive keyboard failures can be decoded from the normal build output.

## 0.1.116 USB HID periodic-endpoint repair + post-interactive diagnostics
- [x] Program xHCI Max ESIT Payload for interrupt/isochronous endpoint contexts instead of leaving periodic endpoints with a zero service-interval payload budget.
- [x] Reject periodic endpoint configuration when the advertised maximum packet size is zero.
- [x] Add xHCI periodic-endpoint configuration breadcrumbs containing slot, DCI, computed interval and maximum packet size.
- [x] Preserve the explicit console-input waiter/wake contract, keyboard-only CLI HID servicing and scheduler-managed input worker from 0.1.114/0.1.115.
- [x] Make Kath append the final guest serial tail and final QEMU 0xE9 debugcon tail when an accepted No Debug QEMU session exits, so post-interactive keyboard faults remain visible in normal run output.

## 0.1.115 USB HID protocol-width compile fix
- [x] Fix the 0.1.114 `UsbHid.Service*` wrappers so they pass byte-typed protocol values to `ServiceProtocol(Byte)` instead of UInt32 literals.
- [x] Audit the new USB HID diagnostic calls for adjacent byte/UInt32 mismatches so the managed kernel build can proceed past the 0.1.114 compile boundary.
- [x] Preserve the explicit console-input wake contract, keyboard-only CLI HID servicing, and end-to-end input diagnostics introduced in 0.1.114.

## 0.1.114 interactive shell USB keyboard wake + CLI HID isolation
- [x] Close the console-input lost-wakeup window by publishing the waiting CPU before STI;HLT and rechecking the input ring before sleeping.
- [x] Explicitly wake the processor sleeping in Get(console.input) whenever a decoded keyboard byte/navigation sequence is queued.
- [x] Keep CLI USB HID servicing keyboard-only so an idle USB mouse interrupt endpoint cannot serialize and starve subsequent keyboard reports.
- [x] Add end-to-end raw diagnostics for HID key events, input-ring queueing, reader wait/wake/read, and editable-console rendering.
- [x] Preserve interrupt-driven xHCI completion and the scheduler-managed input worker; do not reintroduce USB polling in the timer ISR.

## 0.1.113 deferred input worker + xHCI completion diagnostics
- [x] Remove USB HID/xHCI transfers from the Local APIC timer ISR; timer callbacks must never block waiting for a hardware interrupt completion.
- [x] Make the 1 ms input timer callback only coalesce/publish pending input work and wake the scheduler-managed Drivers role worker.
- [x] Run `UsbHid.Service()`, PS/2 service and key-repeat processing in ordinary scheduler thread context so xHCI MSI/MSI-X completion interrupts remain deliverable.
- [x] Add bounded timer-callback, input-queue, Drivers-worker, HID-device, xHCI transfer, doorbell, interrupt and completion debugcon breadcrumbs.
- [x] Add input worker/service counters and startup diagnostics identifying the Drivers worker thread and input timer handle.
- [x] Expand QEMU breadcrumb decoding so a future timeout distinguishes timer ISR, callback dispatch, worker wake/run, HID transfer submission, xHCI IRQ and transfer completion.

## 0.1.112 event-driven role workers + session handoff diagnostics
- [x] Stop the periodic timer ISR from unconditionally waking Userland and Interrupts role workers every 10 ms; role workers are event-driven and must be woken only when real work is queued.
- [x] Prevent timer-driven reschedule/IPI traffic from racing the bootstrap thread during the timer-to-session handoff.
- [x] Expand low-level timer callback diagnostics from the first 8 ticks to the first 32 complete callback entry/exit pairs.
- [x] Add `SESSION_HANDOFF_ENTER/OK` plus raw `0xE9` breadcrumbs before and after `BOOT_STAGE_SESSION`, with an additional raw marker before central session dispatch.
- [x] Update Kath Microkernel/Hybrid/Monolithic generation and existing-project migration so current Test OS projects receive the same session-handoff diagnostics without touching coder-owned `Kernel/<OS>/Kernel.cs`.
- [x] Expand QEMU breadcrumb decoding so timer health and every session-handoff boundary are visible on timeout.

## 0.1.110 STI pending-timer repair + native interrupt diagnostics


## 0.1.111 Local APIC timer activation fix and first-tick diagnostics
- [x] Make periodic Local APIC timer activation atomic by programming it with CPU maskable interrupts temporarily disabled, committing timer state before re-enabling IF.
- [x] Program the Local APIC timer in masked-LVT, divider, initial-count, unmask-last order so an interrupt cannot observe a half-programmed timer.
- [x] Remove noisy generic STI debugcon output from AP scheduler idle loops and replace it with timer-specific low-level diagnostics.
- [x] Add Local APIC timer programming breadcrumbs, timer activation enter/ok/fail breadcrumbs, and first eight timer callback entry/exit breadcrumbs.
- [x] Expand QEMU interrupt breadcrumb diagnostics so timer programming, delivery, callback entry and callback return are distinguishable.

- [x] Stop arming the Local APIC periodic timer during bootstrap; configure its vector/callbacks early but arm hardware delivery only after STI and device interrupt handlers are ready.
- [x] Make x64 `EnableInterrupts` set its return value before STI and use `RET` as the guaranteed post-STI instruction so a pending IRQ cannot trap the native helper before it returns.
- [x] Add explicit `TIMER_IRQ_ENABLE_ENTER/OK/FAIL` transition markers before session startup.
- [x] Add native 0xE9 breadcrumbs at the STI helper and interrupt common entry, including the actual interrupt vector byte.
- [x] Stop QEMU before reading the debugcon file on timeout/failure and retry briefly so Windows file sharing cannot hide the low-level breadcrumbs.
- [x] Update Kath Microkernel/Hybrid/Monolithic generation and existing-project runtime migration to the same timer activation order.
- [x] Preserve interrupt-driven xHCI, the no-PS/2 default, and coder-owned kernel source protection.

## 0.1.109 generated-runtime refresh + interrupt transition diagnostics

- [x] Fix the split-brain startup source where Kath-generated `Kernel/Provided/Core/KernelRuntime.cs` retained the pre-0.1.108 interrupt sequence while central SDK bootstrap source had already moved forward.
- [x] Refresh/migrate the generated kernel runtime during `inu project create` without overwriting coder-owned `Kernel/<OS>/Kernel.cs`.
- [x] Update Microkernel, Hybrid and Monolithic Kath generators to emit the same prepare-before-STI / activate-after-STI xHCI sequence.
- [x] Add dependency-light 0xE9 debugcon breadcrumbs around xHCI prepare/activate and `Interrupts.Run()` so an STI-boundary stall remains observable even when serial/managed logging stops.
- [x] Print the QEMU debugcon hex tail and breadcrumb legend directly in normal acceptance failure/timeout output.
- [x] Preserve the no-PS/2 default and interrupt-driven xHCI runtime path.

## 0.1.108 xHCI interrupt handoff race repair + post-STI diagnostics

- [x] Split xHCI runtime IRQ transition into prepare-before-STI and activate-after-STI phases.
- [x] Allow already-routed xHCI callbacks to acknowledge the STI boundary once the callback path is prepared, even before the device interrupter is activated.
- [x] Treat an observed xHCI IMAN pending bit as handled after acknowledgement even when it carried only a port/status event rather than a command/transfer completion.
- [x] Add explicit host-control markers around xHCI IRQ preparation, global interrupt enable, xHCI IRQ activation, input IRQ enable, and session continuation.
- [x] Teach QEMU runtime acceptance to surface the new interrupt/session transition history on failures and timeouts.
- [x] Add structured USB diagnostics confirming prepared and active xHCI controller counts match configured interrupt routes.
- [x] Keep synchronous xHCI completion draining restricted to bootstrap; normal runtime remains interrupt-driven.

## 0.1.107 USB enumeration service activation fix
- [x] Install the stock `KernelUsbEnumeration` implementation before any xHCI root-port scan.
- [x] Preserve the separation between the USB bus contract and replaceable enumeration implementation rather than hard-wiring enumeration into `KernelUsbBus`.
- [x] Make `KernelUsbEnumeration.Initialize()` idempotent so repeated component startup does not falsely fail.
- [x] Add explicit USB enumeration-service ready/failure diagnostics before root-port discovery.
- [x] Preserve the 0.1.106 class-driver-before-enumeration ordering, interrupt-driven xHCI runtime path and no-PS/2 default.

## 0.1.106 USB enumeration-order and binding repair
- [x] Stop xHCI driver startup from enumerating root ports before USB class drivers are registered.
- [x] Register selected USB hub, HID keyboard/mouse and mass-storage drivers before the single root-port enumeration pass.
- [x] Let dynamic USB interfaces bind to their owning driver as they are discovered instead of relying on the later global driver-binding pass to repair an incomplete USB device tree.
- [x] Treat a selected USB keyboard or mouse with no enumerated HID device as an explicit input-provider failure instead of continuing to an unusable shell prompt.
- [x] Add an explicit `DRIVER_BINDING_FAILED` host marker if the global binding pass itself fails.
- [x] Preserve xHCI MSI-X/MSI/IOAPIC interrupt routing from 0.1.105 and the no-PS/2 default.

## 0.1.105 xHCI interrupt-driven completion delivery
- [x] Register xHCI as an interrupt-capable PCI driver and request delivery through Inu's existing interrupt broker.
- [x] Prefer the broker's MSI-X/MSI routes automatically, with IOAPIC/INTx fallback supplied by the common PCI interrupt router.
- [x] Acquire the xHCI broker route during controller startup, but keep the controller interrupter masked while global maskable interrupts are intentionally disabled during synchronous hardware bootstrap.
- [x] After `InterruptRuntimeStartup.Enable()`, switch every routed xHCI controller to hardware interrupt delivery before the interactive session starts.
- [x] Consume command/transfer completion TRBs from the xHCI interrupt callback and signal kernel completion events instead of scanning the event ring from normal command/transfer waits.
- [x] Use synchronous event-ring draining only during the deliberately interrupt-masked bootstrap window; after runtime interrupts are enabled, polling remains available only through the explicit `KernelXhci.SetPollingFallback(true)` bring-up/debug escape hatch.
- [x] Fail normal xHCI startup when no broker route can be installed instead of silently falling back to runtime polling.
- [x] Disable and release xHCI interrupt delivery during controller teardown and failed-start cleanup.
- [x] Report whether xHCI is using broker-managed interrupts or the explicit polling fallback during USB startup.
- [x] Preserve the 0.1.104 ERDP/EHB acknowledgement correction and deterministic QEMU xHCI HID attachment.

## 0.1.104 xHCI USB HID interactive-input repair
- [x] Clear xHCI Event Handler Busy (EHB) when advancing the event-ring dequeue pointer so command/transfer events continue to flow during USB enumeration and HID polling.
- [x] Keep the xHCI interrupter disabled while Inu uses its polling event path; do not enable an unrouted hardware interrupt source.
- [x] Treat a connected xHCI root-port enumeration failure as a real USB startup failure instead of silently continuing to an unusable shell.
- [x] Attach QEMU USB keyboard/mouse devices to deterministic xHCI ports and print the selected emulated HID devices in the launch diagnostics.
- [x] Preserve the no-PS/2 default; CLI input remains USB HID when that is what the OS selected.

## 0.1.103 ChangedFiles bootstrap packaging repair
- [x] Restore the mandatory root `Build.bat` and `Build.ps1` bootstrap companions to the ChangedFiles release payload.
- [x] Keep the existing bootstrap validation that rejects incomplete ChangedFiles archives before applying an overlay.
- [x] Preserve the 0.1.102 USB HID kernel-console compile fix unchanged; this release repairs the incremental transport/package contract only.

## 0.1.102 USB HID kernel-console build fix
- [x] Fix the USB HID capability diagnostic newline to use the supported kernel `KernelConsole.WriteLine(String)` contract.
- [x] Keep parameterless `WriteLine()` only where the owning host/userland console API actually defines that overload.
- [x] Restore managed kernel compilation after the 0.1.101 USB HID text-console keyboard-routing change.

## 0.1.101 USB HID text-console keyboard routing
- [x] Bind the selected USB HID keyboard event handler when the text session is actually started, after xHCI/HID enumeration is online.
- [x] Keep early input timer registration, but do not assume early `InputHardwareStartup.Initialize()` can bind USB handlers before USB startup has run.
- [x] Respect USB keyboard and mouse selection independently when attaching handlers; do not require a mouse handler for a keyboard-only CLI OS.
- [x] Add `TEXT_INPUT_USB_*` diagnostics for HID readiness, keyboard/mouse presence and handler binding.
- [x] Add one-shot `USB_KEYBOARD_FIRST_EVENT`, `USB_KEYBOARD_FIRST_PRESS` and `USB_KEYBOARD_FIRST_CHARACTER_QUEUED` diagnostics to distinguish transport, decode and console-queue failures.
- [x] Fix the CLI symptom where the shell prompt appears but USB keyboard input is silently discarded when PS/2 is disabled.

## 0.1.100 mounted OS namespace / FAT directory bootstrap
- [x] Stage the coder-visible filesystem hierarchy at the FAT32 root (`/System`, `/Drives`, `/User`, `/Temp`) while keeping `/INU` boot-private.
- [x] Mirror shell, command/help, font and wallpaper payloads into the mounted `/System` hierarchy so logical filesystem paths correspond to real on-disk locations.
- [x] Pre-stage drive/partition mount-point directories for the system drive and selected persistent data controllers so basic boot policy does not depend on mutating the system partition.
- [x] Make the FAT provider directory-create primitive idempotent when the target already exists as a directory.
- [x] Fix the stock Test OS failure at `OS_POLICY_DRIVES_DIRECTORY_FAIL`.

## 0.1.99 logical-path template validation
- [x] Separate logical-path templates from concrete filesystem paths so mappings such as `/User/{user}` are valid without weakening normal VFS path validation.
- [x] Preserve and externalize validated `{name}` placeholders through `FileSystem.SetLogicalPath`/`GetLogicalPath` while keeping command paths and concrete paths strict.
- [x] Fix the stock Test OS `VisibleUser` policy failure at `OS_POLICY_VISIBLE_USER_PATH_FAIL`.


## 0.1.98 stock Test OS policy diagnostics
- [x] Add statement-level OS_POLICY diagnostics to newly generated filesystem/storage/text-session policy.
- [x] Safely instrument existing untouched stock Test OS Kernel.cs during project refresh while preserving any coder-edited policy byte-for-byte.
- [x] Distinguish path-policy, logical-path, system-drive, system-volume/FAT detection, root mount, drive-directory, data-mount, logical-directory and text-session failures.


## 0.1.97 authoritative selection / storage-policy diagnostics
- [x] Make Test OS networking obey the explicit Kath selection instead of forcing the kernel networking area on.
- [x] Make generated Microkernel startup omit networking/USB stages when those kernel areas are not selected.
- [x] Add OS-policy enter/return markers around coder-owned Kernel.Start() and include them in QEMU session-history diagnostics.
- [x] Re-run partition discovery after all selected block drivers are online for drives that still have no registered volume, with per-drive recovery diagnostics.
- [x] Keep the generic SDK kernel composition conditional on the selected Networking and USB kernel areas.


## 0.1.96 session diagnostics / cache diagnostics
- [x] Dispatch CLI-only Microkernel boots directly to `TextConsoleSessionStartup` after `BOOT_STAGE_SESSION`.
- [x] Add session/input/shell host-control markers so failures before ring-3 shell entry identify the exact boundary.
- [x] Include session marker history in QEMU explicit-startup-failure diagnostics.
- [x] Report concrete SHA-256 cache-miss reasons for cached build stages.

## 0.1.96 session/cache fixes

- [x] Start CLI sessions through `TextConsoleSessionStartup` so selected text input providers are verified before shell launch.
- [x] Resolve the built-in `/SYSTEM/SHELL/SHELL.EXE` through Inu's canonical internal namespace rather than the OS-selected external path separator.
- [x] Publish shell session/create/start/reactivation markers and surface their history in QEMU acceptance failures.
- [x] Stop `Refresh selected Inu project` from hashing its own generated output tree, so an unchanged project can retain its SHA-256 cache and avoid unnecessary downstream recompilation.

- [x] 0.1.94: keep normal New OS defaults explicitly free of PS/2 and networking unless selected, make AHCI skip implemented-but-empty SATA ports immediately and use tighter bounded polling for active ports/IDENTIFY, emit an explicit AHCI failure marker, and make QEMU acceptance fail immediately on explicit BOOT_STAGE_*_FAILED diagnostics.
- [x] 0.1.93: keep Kath's private @kath/extension dependency pinned to the authoritative local release so npm never falls back to the public registry, and add SHA-256 input/output caching to each SDK central reference project so unchanged reference libraries are not recompiled.
- [x] 0.1.92: hash every source/build input independently with SHA-256 before any recompilation decision, avoid unrelated orchestration-triggered rebuilds, and add detailed storage startup ENTER/OK markers, capability counts and complete kernel startup marker-history diagnostics.
- [x] 0.1.91: fix generated Microkernel/Hybrid/Monolithic startup ordering and selected USB/HID initialization, add per-stage QEMU acceptance progress windows so slow TCG boot progress is not mistaken for a hang, and make Microkernel the ProjectCreator default/fallback as well as the Kath default.
- [x] 0.1.90: make hardware selection authoritative at composition time so unselected PS/2 code is not compiled/materialised, keep USB HID independent, and make Microkernel the default kernel model for both new normal OS and Test OS projects.
- [x] 0.1.89: make normal QEMU runs derive USB/network/graphics hardware from the project Inu.json; attach selected xHCI HID devices; and make bootstrap PS/2/USB input startup obey the individual configured input selections instead of broad Test-OS work-area inclusion.
- [x] 0.1.88: repair ChangedFiles packaging so every incremental release includes the required root Build.bat and Build.ps1 bootstrap companions; preserve the 0.1.87 boot-order fix unchanged.
- [x] 0.1.87: fix QEMU acceptance stalling after PS/2 input startup by deferring PS/2 hardware IRQ arming until synchronous hardware/filesystem/userland initialization is complete, then enabling runtime interrupts before device IRQ delivery; add explicit boot-stage markers around the final interactive-session hand-off.
- [x] 0.1.86: keep CLI/Test-kernel VirtIO-GPU validation non-blocking by retaining UEFI GOP unless the kernel GUI area is selected, so storage/filesystem/userland startup cannot be stalled by full display promotion.
- [x] 0.1.85: mount every detected usable storage volume while keeping only the bootable drive as the system drive; make optional Test OS hardware absence non-fatal; add system-drive/volume discovery APIs; improve AHCI SATA COMRESET/readiness before IDENTIFY; refresh untouched stock Test OS storage policy.
- [x] 0.1.84: fix the Inu bootstrap version verifier so it captures the CLI exit code immediately, extracts a normalized semantic x.y.z value from external-process output, and reports execution/parse/mismatch failures separately instead of rejecting visually identical versions.
- [x] 0.1.83: fix unified Inu host bootstrap compilation by fully qualifying Microsoft.Extensions.Hosting.Host.CreateApplicationBuilder; audit the new host-service integration for the same namespace collision; restore ChangedFiles incremental metadata so 0.1.83 correctly upgrades from 0.1.82.
- [x] 0.1.82: fix Test OS Boot.cs hosted-namespace leakage and {user} path-placeholder diagnostics; establish C# host services with Microsoft.Extensions.Hosting/DI, Roslyn C# analysis, typed SDK API catalog, hosted SDK validation and disk-image discovery; add MSBuild/NuGet Inu.Sdk props/targets and make Kath use the C# host for Roslyn diagnostics, API metadata, disk discovery and final project refresh.
- [x] 0.1.81: fix New Test OS generation by separating Boot/Kernel/Userland API exposure from the freestanding kernel dependency plan; hosted Boot/reference assemblies are no longer copied into the kernel, while every genuinely freestanding available Kernel component remains included and new OS creation can complete and open its generated workspace.
- [x] 0.1.80: consolidate SDK host operations behind the single Inu/Bin/inu.exe contract; internal compiler/linker/image/QEMU/project/userland modules no longer produce separate apphost executables; Kath and generated Build/Run launchers use inu.exe; New OS creation verifies required source files and opens the exact generated workspace directly instead of depending on a registry rescan.
- [x] 0.1.79: make New Test Kernel the complete SDK validation target: expose all current Boot/Kernel/Userland public namespaces, compile every available SDK source-component project, select all currently supported Test-OS hardware families, bound AHCI/NVMe probe waits, and give the complete Test Kernel a separate bounded 45-second QEMU acceptance window so exhaustive hardware probing cannot masquerade as a normal-OS timeout.
- [x] 0.1.78: fix QEMU ICH9 AHCI discovery by validating the MMIO BAR against the ports the controller actually implements, add bounded SATA readiness detection, and distinguish controller-start from disk-IDENTIFY failures in serial diagnostics.
- [x] 0.1.77: fix ChangedFiles-only upgrades so Build.bat never mistakes a delta ZIP for FullSource; ChangedFiles now carries the root bootstrap pair for compatibility with older bootstraps, while bootstrap refresh selection is FullSource-only.
- [x] 0.1.76: move the generated Inu SDK API reference into SDK/Help, rewrite it around a persistent Boot/Kernel/Userland namespace sidebar, add SDK purpose/usage/expansion guidance and Boot API contracts, and update Kath Help to open the new SDK Help path.
- [x] 0.1.75: Generated coder-owned Kernel.cs now configures path/folder policy before storage policy, enumerates every detected block drive by ordinal, and provisions only selected writable NVMe/AHCI data drives by default while leaving the boot/system drive untouched.
- [x] 0.1.74: fix storage formatter/provisioner Byte-pointer CS0266 regressions, retain coder-owned Kernel.cs drive policy, and remove misleading SystemAssetCatalog fixed-buffer warnings.
- [x] 0.1.73: make the coder-owned Kernel/<OSName>/Kernel.cs explicitly own drive partitioning, formatting, mounting and initial directory layout; fix NVMe/AHCI driver source dependencies and expose safe/non-destructive plus explicit destructive storage APIs.
- [x] 0.1.72: repair the QEMU launcher top-level-statement compile regression; QEMU now creates raw persistent NVMe/AHCI backing disks only, while the Inu kernel safely provisions blank selected drives with two GPT partitions, FAT32-formats the new partitions, seeds USERS/WORK/TEMP on partition 1, preserves existing partitioned disks, and mounts the real writable data filesystem.
- [x] 0.1.71: selected NVMe/AHCI controllers now materialize as persistent writable QEMU data disks, each with GPT and two FAT32 partitions; partition discovery starts before storage drivers, Microkernel builds retain the minimal kernel storage/VFS mechanism until ring-3 services replace it, and the first data partition becomes the writable root instead of the asset catalogue.
- [x] 0.1.70: make GitHub publication genuinely bounded: push uses live console output instead of redirected async pipes, timed-out Git kills the entire helper/credential process tree, and the root build imposes an independent 120-second publisher watchdog.
- [x] 0.1.69: stop filesystem-mutating ring-3 commands from silently hanging when no writable filesystem service/mount exists; report userland exceptions on-screen plus serial markers, start/mount selected kernel-domain storage/filesystem components, and emit the selected VirtIO/NVMe/AHCI storage constants.
- [ ] Microkernel/Hybrid filesystem persistence: implement the selected storage/filesystem graph nodes as real runnable ring-3 services with IPC through Get/Set/Event, then route file/directory syscalls to those services instead of returning `NotSupportedException` when no kernel-domain mount exists.
- [x] 0.1.68: stop post-build GitHub publication from hanging a completed Kath/Inu build; ignore generated build output, untrack artifacts accidentally committed by older releases, run Git non-interactively with finite timeouts, and keep local build success independent from GitHub availability.
- [x] 0.1.67 Source-ownership cleanup: make Inu/SDK/src the sole home of kernel startup implementations, remove duplicate NativeAOT bootstrap sources, remove per-product VERSION mirrors, and add a build-time duplicate-source ownership verifier.
- [x] 0.1.66 Keep resident shell Configure() truly one-time across command hand-offs, and let Debug continue booting when source breakpoints are pending/unverified instead of parking the kernel before KMain.
- [x] 0.1.65 Open newly generated OS workspaces with a clean editor state, stop the Run/Debug build counter at the QEMU handoff, and remove the shell entry path's avoidable managed Action-delegate dependency by using direct managed function pointers for Configure/Run.
- [x] 0.1.64 Fix freestanding ArgumentException(message, paramName) compatibility used by userland commands, and make Kath Run/Debug measure the complete build/launch-acceptance elapsed time from button press instead of parsing individual stage heartbeat text.
- [x] 0.1.63 Exception-first failure propagation: managed host/compiler failure paths throw at the point the failure is detected; integer process exit codes remain only at executable/foreign-process ABI boundaries and are translated immediately into exceptions.
> **0.1.62** makes `InuShell.cs` a lifecycle runner only. Shell policy, prompt, input, parsing, command lookup and execution remain in coder-owned `Shell.cs`; InuShell now runs `Shell.Configure()` once and repeatedly invokes one-iteration `Shell.Run()`. The userland compiler always includes this runner and no longer contains the legacy prompt-based InuShell path.

> **0.1.61** fixes a Kath extension TypeScript build failure: the dashboard described the literal `Kernel/<OSName>/SDKSource` path directly in JSX, causing `<OSName>` to be parsed as a JSX element. The wording now describes the destination without JSX-like angle brackets.

> **0.1.60** corrects source ownership and diagnostic navigation: Kath's generated `Kernel/<OSName>/Kernel.cs` remains the OS-owned kernel composition; SDK source opened from an external compiler diagnostic is copied once into the visible `Kernel/<OSName>/SDKSource/` tree, and an existing copy is never overwritten. Diagnostic snapshots are excluded from compilation until the OS author deliberately integrates them. The SDK ProjectCreator no longer carries unused shell migration/repair helpers, and remains a project generator rather than a home for kernel runtime behaviour. The generated kernel is assembled by Kath from the selected configuration and Inu component definitions.

> **0.1.59** makes SDK source opened from a compiler diagnostic visible in Kath’s workspace tree by adding the existing `Inu/SDK` directory as a workspace root. Editing and building continue to use the same physical file; no SDK source is copied into the generated OS.

> **0.1.58** preserves coder-owned `Userland/<OSName>/Shell.cs` byte-for-byte during compile/run preparation. Removed automatic shell migration/repair calls from the ProjectCreator preparation path; new shells still receive the current template only when Shell.cs does not exist.

> **0.1.56** separates Test OS Debug validation symbols from the explicit native source-debugger rendezvous end-to-end. Ordinary Test OS runs may compile/link with Debug symbols without requiring `InuDebugImageAnchor`/`InuDebugResume` or `Inu.DebugSymbols.json`; explicit Debug source-debug builds still require and validate the rendezvous.

> 0.1.55 separates Test OS Debug validation from the source-debugger rendezvous: ordinary Test OS Run still forces Debug so Debug-only validators execute, but native Entry.asm no longer parks at InuDebugImageAnchor unless Debug was explicitly requested for an actual debugger build. QEMU acceptance also reports an early native-entry stall separately instead of mislabelling it as a TrueType timeout.

> 0.1.54 fixes the Kath missing-namespace quick-fix provider against the Monaco/Theia API version actually shipped by Kath: remove unsupported providedCodeActionKinds/CodeActionKind usage and include the required model versionId in workspace text edits. The Add using quick fix behaviour remains unchanged.

> 0.1.53 makes the SDK Test OS source template use the requested live kernel/shell policy, repairs the invalid duplicate Prompt expression in existing Test OS shells, makes Kath path-separator diagnostics compare active kernel and shell policy while ignoring comments, and changes missing Inu namespace handling from silent source edits to a squiggle with an Add using quick fix.

> 0.1.52 adds `FileSystemPaths.GetCurrentWorkingDirectory()` as the ordinary userland CWD API, makes newly generated shell prompts dynamic (`[cwd] >`) so `cd` is reflected immediately, and safely migrates the untouched stock prompt or the earlier `FileSystem.FileSystemLogicalPath()` prompt attempt without rewriting unrelated custom prompts.

> 0.1.51 fixes the stock `Dir` userland command so it imports `Inu.Userland.Runtime` for `FileSystemPaths`, and teaches Inu.ProjectCreator to safely refresh the untouched broken 0.1.50 stock `Dir.cs` during existing-project refreshes without overwriting coder-edited commands.

> 0.1.50 fixes existing SDK Test OS refreshes: Inu.ProjectCreator now repairs the missing `using Inu.Kernel.Storage;` import when a Test OS kernel already uses filesystem facade APIs, so coder-owned Test OS kernels created before 0.1.49 compile without being regenerated or overwritten.

- [x] 0.1.48: repair shared tuple conformance source so nullable `ITuple` reads compile with warnings-as-errors and language tuple deconstruction is tested using C# deconstruction syntax rather than a nonexistent `ValueTuple.Deconstruct` member.
- 0.1.46 fixes the invalid generic ValueTuple constructor declarations from 0.1.44/0.1.45 and adds a first-class Kath **Test OS** profile. Test OS is explicitly marked in configuration/manifests/UI, always uses Debug so Debug-only hardware validators are eligible, forces host reference plus in-kernel managed/BCL/GC/ABI conformance on every Run, and continues through selected subsystem startup/contract validation. Normal OS Release behaviour is unchanged.
- [x] 0.1.47: make shared conformance sources self-contained release companions; refresh all five linked Shared sources in ChangedFiles and validate manifest-linked files after clean install before reference compilation.
- 0.1.45 adds the practical Profile 1 LINQ subset in `System.Linq.Enumerable`: deferred Select/Where; First/FirstOrDefault/Single/SingleOrDefault with predicate overloads; Any/All/Count; comparer-aware Contains; ToArray/ToList; and stable deferred OrderBy using O(n log n) merge sort. One shared host/in-kernel conformance source owns the expectations.
- [x] Offer a first-class **Test OS** in Kath. Test OS projects are explicitly marked `projectKind: test-os` / `TestOs: true` and carry a `TEST-OS.md` marker. They contain the full validation harness, but ordinary No-Debug runs boot normally; Debug (or explicit runtime-conformance) runs execute the in-kernel managed/BCL/GC/ABI validation before continuing through selected subsystem startup/contract validation.

- 0.1.44 adds ordinary C# tuple support: System.Tuple factories/classes, System.ValueTuple arities including large-tuple Rest nesting, TupleElementNamesAttribute/ITuple compiler-runtime contracts, and one shared host/in-kernel tuple conformance source.

- 0.1.43 restores the System.Text section accidentally removed from Inu.Freestanding.CoreLib during the 0.1.42 collections edit, preserving the completed collections work while restoring StringBuilder, Encoding, ASCIIEncoding and UTF8Encoding for SDK/reference builds.

- 0.1.42 completes the requested core generic collections pass: Dictionary<TKey,TValue> (including keys/values, collision/resizing and IEqualityComparer<TKey>), adds HashSet<T>, finishes Queue<T>, Stack<T>, and KeyValuePair<TKey,TValue>, and authors all five behavioural contracts once in shared host/in-kernel conformance source.

- 0.1.41 fixes the shared `List<T>` conformance null-argument test so nullable analysis does not block the host reference build: the test now uses a nullable-suppressed typed `IEnumerable<int>` variable and still verifies `AddRange(null)` throws `ArgumentNullException`.

# Inu .NET Compatibility TODO

- 0.1.40 completes the requested `System.Collections.Generic.List<T>` Profile 1 surface, including Add/AddRange (including self-add), remove/remove-at, clear, contains/index lookup, insert, count/capacity, indexer bounds/set behaviour, generic/non-generic enumeration with version/state rules, and independent `ToArray`; the List expectations are authored once in shared conformance source for both host and in-kernel runners.

- 0.1.39 fixes array bounds conformance so negative-index checks use runtime variables and moves the completed `System.Array` / `IEnumerable` / `IEnumerator` / `IEnumerable<T>` / `IEnumerator<T>` expectations into one shared source file compiled by both the host reference runner and the in-kernel runtime gate. This prevents the two environments from drifting on expected values while preserving their separate roles.
> **Authoritative implementation backlog**
>
> This file is the project-wide source of truth for planned Inu/.NET compatibility work. Before starting the next planned SDK compatibility change, read this file, select the highest applicable unchecked item, and update the checklist in the same release. Bug-fix releases may be performed out of sequence, but any affected backlog item must be updated here. Do not maintain a second TODO/roadmap copy elsewhere in Inu or Kath.
>
> **Release packaging rule:** every FullSource and ChangedFiles archive must contain this current `TODO.md` at the archive root. If implementation status, dependencies, sequencing, completion criteria, or release-policy notes change, `TODO.md` must be updated in that same release before either ZIP is created. A stale TODO is a release validation failure. A separate standalone `TODO.md` download is not required unless the user explicitly asks for one; the copies at the root of both release ZIPs are authoritative.

## Goal

Make Inu feel like a normal .NET/C# environment to the OS developer while remaining freestanding, NativeAOT-compiled, component-based, and architecture-neutral.

The project does not need to implement every namespace in the Microsoft .NET BCL at once. However, **every type, namespace, feature or API area explicitly listed in this TODO is a full .NET 10 compatibility target**. A listed item may not be marked complete while any .NET 10 public member, required interface contract, runtime-required member, documented behaviour, exception rule, boundary case, generic behaviour, formatting/parsing path, or applicable overload for that item remains unsupported.

The compatibility surface is tracked as:

> **Inu .NET Profile 1**

For each TODO-listed compatibility target, completion requires:
- the full applicable .NET 10 public API surface for that target;
- all required explicit interface implementations and NativeAOT/runtime contracts;
- .NET-compatible documented behaviour, including exceptions and edge cases;
- no reduced subset hidden behind a completed checkbox unless the TODO explicitly identifies it as a separate, deliberately excluded future target.

Every supported API must have:
- a reference-side contract for Kath/IntelliSense and compilation;
- matching Inu runtime behaviour;
- reference-side conformance tests;
- in-kernel/runtime conformance coverage where runtime behaviour is involved;
- clear diagnostics when an API is outside the selected Inu profile.

- 0.1.49: Test OS kernel policy now imports the storage/filesystem facade under every kernel topology, and new Test OS presets select FAT32 so filesystem validation is genuinely part of the SDK test profile.

---

# Completed requested shell/console work

- [x] Shell scrollback and editing usability
  - [x] Page Up / Page Down scroll retained output by a page
  - [x] typing or editing returns the viewport to the live input prompt
  - [x] Up / Down browse previously submitted commands
  - [x] Enter executes the recalled command currently displayed
  - [x] Left / Right move the insertion caret through the current line
  - [x] Home / End and Delete integrate with the same editable-line model
  - [x] caret height is user/SDK configurable from underline to full block
  - [x] caret mode supports blinking, continuously visible, and off
  - [x] foreground/background colours are user/SDK configurable RGB values
  - [x] stock `console` userland command exposes colour/caret settings without adding kernel command policy
  - [x] stock `fgcolour` and `bgcolour` commands let OS users change foreground/background RGB values directly
  - [x] Tab searches the configured command directories and cycles matching installed command names without a hard-coded command registry
  - [x] Tab completes filesystem/path arguments at the caret, so `dir sy<Tab>` resolves matching entries such as `dir System` and repeated Tab cycles matches
  - [x] Page Up / Page Down use the same shell input queue as other navigation keys and scroll retained output reliably
  - [x] generated HAL input routing preserves Up/Down/Left/Right/PageUp/PageDown and applies the 500 ms / 40 ms held-key repeat policy
  - [x] 0.1.16 routes non-text navigation through standard ANSI escape sequences over the same known-working console byte path as ordinary text, with the userland line editor decoding Up/Down/Left/Right/Home/End/Delete/PageUp/PageDown
  - [x] 0.1.17 fixes the ANSI escape prefix byte in the kernel input transport so previously generated/selected kernels compile without a `uint`-to-`byte` conversion error
  - [x] shell command history is kernel-session backed so Up/Down survives the shell process restart used when launching each foreground command
  - [x] console support remains a centrally refreshed SDK dependency unless the coder explicitly materialises/takes ownership of it
  - [x] existing projects with legacy Boot-owned console source plans are migrated to the current central console dependency without deleting the old physical source
  - [x] new console Get/Set/Event message registration remains source-compatible with older coder-owned syscall implementations by using the stable ABI message strings directly

---


# Completed startup-selection consistency

- [x] CLI-only startup does not materialise, build, stage, configure, or attempt the stock GUI desktop/login applications
- [x] graphical desktop/login source and executables are included only when `gui` or `cli-gui` startup is selected
- [x] stock kernel session startup consults generated startup policy before calling graphical-session autostart
- [x] build elapsed-time heartbeats stay on one horizontal status line instead of producing a vertical line per second
- [x] 0.1.23 elapsed-time heartbeats repaint the same visible value (`1s` → `2s` → `3s`) instead of appending seconds, and Kath interprets carriage-return progress as an in-place update
- [x] 0.1.35 Kath highlights the changing elapsed-seconds value in the Run toolbar while retaining the single in-place Output heartbeat
- [x] 0.1.36 root `Build.bat` refreshes a stale `Build.ps1` from the newest newer FullSource ZIP before source/version selection, preventing old bootstrap logic from checking obsolete `Bin\Kath.exe` locations; ChangedFiles overlays also enforce their declared `baseVersion` so releases cannot be skipped
- [x] 0.1.23 removes the unsupported freestanding `StringComparison` dependency from CLI/GUI startup selection

---

# Completed requested userland command/runtime work


- [x] 0.1.24 command build caching survives host `Inu.UserlandCompiler` rebuilds by fingerprinting compiler source/project inputs instead of the rebuilt compiler DLL
- [x] 0.1.24 requested `Span<T>` foundation: indexing, slicing, length, empty/array-backed spans, copy, fill, clear and window-identity equality, with host and in-kernel conformance coverage
- [x] 0.1.25 completes the .NET 10 type-owned `Span<T>` and `ReadOnlySpan<T>` Profile 1 surfaces, including managed/native byref storage, ref/pointer constructors, enumeration, pinning, ArraySegment conversion, ReadOnlySpan covariance and paired conformance coverage
- [x] 0.1.27 restores Roslyn/.NET 10 compiler-known `RuntimeHelpers.InitializeArray` and `CreateSpan<T>` intrinsics required by constant `ReadOnlySpan<T>` RVA/blob lowering, with host and in-kernel regression coverage
- [x] 0.1.28 completes the .NET 10 type-owned `Memory<T>` and `ReadOnlyMemory<T>` surfaces, including equality/hash, copy/try-copy, pinning, `ArraySegment<T>` conversions, covariance/range rules, formatting, and paired host/in-kernel coverage
- [x] 0.1.30 fixes the `System.String` reference conformance expectation for `"bananas".LastIndexOf('a')` (correct .NET result: index 5) and adds granular String subcheck diagnostics
- [x] 0.1.31 restores the compiler-required `System.String.get_Chars` metadata contract by emitting the string indexer as `Chars`
- [x] 0.1.32 restores the NativeAOT string-construction companion contract: every supported public `System.String` constructor has a matching private static `Ctor(...)` implementation, with host and in-kernel coverage for `char[]`, `char,count`, and `char[],start,length`
- [x] 0.1.33 completes Profile 1 string interpolation runtime support and composite formatting, including the compiler-known default interpolated-string handler, indexed placeholders, alignment, escaped braces, basic format strings, and the existing invariant numeric formatting subset
- [x] 0.1.34 fixes the in-kernel interpolation conformance test to reference `System.Runtime.CompilerServices.DefaultInterpolatedStringHandler` explicitly, avoiding `Inu.Runtime` namespace shadowing
- [x] 0.1.35 completes the requested `System.Text.StringBuilder` Profile 1 surface and adds a highlighted live elapsed-seconds badge to Kath's Run toolbar
- [x] 0.1.37 completes the requested ASCII/UTF-8 encoding support (factories, byte/character counts, array/range/span encode/decode) and explicitly defers UTF-16 encoding APIs from Profile 1
- [x] unchanged command executables survive Kath host-tool rebuilds; both the outer Ring-3 stage and per-command cache use compiler source/project inputs rather than the freshly rebuilt `Inu.UserlandCompiler.dll`
- [x] ring-3 build output says it is checking executables and reports per-stage cache hits instead of claiming every command is being compiled
- [x] stock command source uses the stable `Inu.Userland.Commands` namespace instead of embedding the generated OS name
- [x] Kath stops rewriting stock command namespaces to `KathInu.<OS>.Userland.Commands`
- [x] existing generated stock command namespaces are migrated to the stable namespace without changing coder-owned custom command bodies
- [x] all ring-3 commands/applications share one SDK-owned NativeAOT process entry wrapper
- [x] per-command NativeAOT/module/bootstrap code is no longer generated into command source; only a hidden compiler binding selects the command `Main` method
- [x] command entry discovery supports normal `int Main()`, `void Main()`, `int Main(string[] args)` and `void Main(string[] args)` forms
- [x] `CommandLine.GetArguments()` supplies ordinary C# `string[]` arguments to `Main(string[] args)` and supports quoted whitespace
- [x] stock commands that consume arguments use ordinary `Main(string[] args)` instead of Inu-specific raw-argument plumbing
- [x] generated HAL keyboard routing no longer swallows Up/Down/Left/Right/Home/End/Delete
- [x] generated HAL routes Page Up / Page Down to retained console scrollback for both PS/2 and USB HID keyboards
- [x] generated HAL navigation key translation uses byte-compatible keycode constants so refreshed PS/2/USB input source compiles without `uint`-to-`byte` conversion errors
- [x] held repeatable keyboard input waits 500 ms before software repeat begins, then repeats at the existing 40 ms interval until key-up
- [x] kernel policy can dynamically create/run any command installed under the configured CommandsPath(s), without embedding a command-name registry and without moving command execution out of isolated ring 3
- [x] `Inu/SDK/src/Userland/Commands/*.cs` is the single SDK source of reference for stock executable command implementations
- [x] ProjectCreator materialises each stock command only once into the coder-owned `Userland/<OS>/Commands` tree and no longer duplicates command source under `Userland/Provided`
- [x] refresh removes legacy duplicate `Userland/Provided/Commands` and `Userland/Provided/SysInfo` command trees
- [x] refresh-stage caching validates stable generated project outputs instead of snapshotting pre-refresh files, so deleting legacy duplicate command trees cannot trigger a false missing-output failure
- [x] the duplicate SDK `src/Userland/SysInfo/SysInfo.cs` implementation is removed in favour of canonical `src/Userland/Commands/SysInfo.cs`
- [x] ChangedFiles/source-install cleanup explicitly removes the legacy duplicate `src/Userland/SysInfo/SysInfo.cs` so upgrades converge to the same single-source command tree
- [x] all stock C# command implementations use normal human-readable C# formatting rather than compressed generated-looking one-line statements
- [x] unmodified 0.0.141 generated stock commands are refreshed to the canonical formatted source while coder-edited command files remain untouched

---

# Completed requested Kath source-diagnostic work

- [x] Kath live analysis reports literal `FileSystemPaths` separator-policy mistakes as `INU1007` editor diagnostics
- [x] invalid literal command-path separators receive red Monaco squiggles at the exact offending character
- [x] ring-3 build validation emits the same `INU1007` diagnostic with source file, line and column so the Problems entry remains clickable
- [x] `FileSystemPaths.SetCommandsPaths` rejects dynamically supplied command paths when separator-like punctuation differs from whatever separator the OS author selected
- [x] kernel path normalisation enforces the same selected-separator rule as the userland API without hard-coding `:`, `/`, or `\`
- [x] Kath Problems visually distinguishes source-navigable diagnostics from non-navigable build summaries
- [x] source-navigable File/Line cells use the theme link colour and pointer cursor; summary rows use muted text and the normal cursor
- [x] separator diagnostics derive the expected joiner from the coder's `SetPathSeparator(...)` value and flag different separator-like punctuation rather than assuming a particular separator
- [x] root `TODO.md` is required by the build bootstrap, copied during clean-source installation, and preserved by root cleanup
- [x] same-version FullSource bootstrap repairs a stale root `TODO.md` from the matching release ZIP before building the already-extracted source tree
- [x] ChangedFiles is a first-class incremental bootstrap path: newer ChangedFiles ZIPs are overlaid onto an existing source tree before version propagation
- [x] matching ChangedFiles ZIPs restore the authoritative root `TODO.md`, so users who normally install only ChangedFiles do not retain a stale checklist
- [x] release packaging copies the already-finalised FullSource root `TODO.md` byte-for-byte into ChangedFiles; the two archives never maintain separate TODO content
- [x] long-running build stages use a one-line 1-second elapsed-time heartbeat instead of appending periodic wait messages
- [x] QEMU launch PID publication is owned by the detached starter using the actual `Start-Process -PassThru` process ID, so a live shell cannot be reported as "QEMU did not publish its PID"
- [x] Kath scans restored/already-open C# editor models on workbench startup instead of waiting for focus, edits, Build, or Run
- [x] live Kath diagnostics are mirrored into the Problems list immediately and remain there while build-output diagnostics are cleared/refreshed
- [x] simple C# invalid string/character escape sequences such as `\C` are reported live as `CS1009` squiggles/Problems without running a build

---

# Completed requested Kath asset-selection work

- [x] Optional BMP Logo uses a browseable file dialog rather than requiring a manually typed path
- [x] the chooser allows directory navigation and selects one BMP file
- [x] Kath validates that the selected logo uses the `.bmp` extension
- [x] when the OS is created/reconfigured, Kath copies the logo into the coder-owned kernel asset path `Kernel/<OS>/Assets/Logo.bmp`
- [x] `Inu.json` stores the copied project-local kernel asset path instead of the original external source path
- [x] legacy root `Assets/Logo.bmp` copies are migrated/removed when the logo is materialised into the kernel Assets folder
- [x] clearing the optional logo removes Kath's generated kernel logo copy
- [x] `TODO.md` remains the single authoritative backlog at the source-tree root and at the root of both release ZIPs

---

# Priority 1 — Complete the primitive/runtime foundation

- [x] Finish `System.Object`
  - [x] `Equals`
  - [x] `ReferenceEquals`
  - [x] `GetHashCode`
  - [x] `ToString`
  - [x] runtime type identity consistency
  - [x] Add runtime type-name metadata so default `ToString()` returns the actual derived type name like .NET
  - [x] Implement `System.Type.Name` from NativeAOT TypeMap/EmbeddedMetadata, including primitive, nested, generic-definition and parameterized type names

- [x] Finish Boolean support — **full .NET 10 `System.Boolean` contract**
  - [x] `TrueString` / `FalseString`
  - [x] `GetHashCode`
  - [x] `ToString()`
  - [x] `ToString(IFormatProvider)`
  - [x] `TryFormat(Span<char>, out int)`
  - [x] typed/object equality
  - [x] typed/object comparison
  - [x] `Parse(string)` / `Parse(ReadOnlySpan<char>)`
  - [x] `TryParse(string, out bool)` / `TryParse(ReadOnlySpan<char>, out bool)`
  - [x] complete `IConvertible` implementation
  - [x] complete `IParsable<bool>` implementation
  - [x] complete `ISpanParsable<bool>` implementation
  - [x] advertise `.NET 10` static-interface support through `RuntimeFeature.VirtualStaticsInInterfaces`
  - [x] complete all .NET 10 Boolean conversion behaviour and exception semantics
  - [x] verify the complete .NET 10 public surface has no missing Boolean members
  - [x] reference-side conformance for every public/explicit-interface Boolean member
  - [x] in-kernel/runtime conformance for every runtime-dependent Boolean member
  - [x] host-side Boolean conformance project enables nullable annotations so the .NET 10 nullable signatures compile exactly as declared
  - [x] nullable flow annotations in the host conformance helpers/tests match .NET results without suppressing nullable analysis

- [x] Finish character support
  - [x] comparison — typed/boxed ordering, equality, .NET-compatible hash code, null/wrong-type behaviour
  - [x] classification subset — ASCII, ASCII letter/digit/hex variants, inclusive range, control characters, and .NET Unicode whitespace set
  - [x] conversion — `Parse`/`TryParse`, `IParsable<char>`, `ISpanParsable<char>`, complete `IConvertible` character matrix, and matching `Convert` character overloads/exception behaviour
  - [x] formatting — `ToString()`, provider/static forms, `IFormattable`, and allocation-free `ISpanFormattable`
  - [x] reference-side .NET 10 conformance coverage for the completed character surface
  - [x] in-kernel/runtime conformance coverage for the completed character surface
  - [x] in-kernel/runtime conformance uses distinct conversion-result locals for Boolean → Char and Char → Boolean so the completed character gate compiles cleanly

- [x] Finish signed integer types
  - [x] `sbyte` — completed freestanding primitive surface and .NET 10 conformance coverage
  - [x] `short` — completed freestanding primitive surface and .NET 10 conformance coverage
  - [x] `int` — completed freestanding primitive surface and expanded existing conformance coverage
  - [x] `long` — completed freestanding primitive surface and .NET 10 conformance coverage
  - [x] parsing — `Parse`/`TryParse` for strings and spans, whitespace/sign handling, overflow/format distinction, `IParsable<T>` and `ISpanParsable<T>`
  - [x] formatting — general/decimal/hex formatting, precision, provider overloads, and `ISpanFormattable.TryFormat`
  - [x] checked conversion — checked narrowing/widening behaviour and `Convert`/`IConvertible` overflow semantics covered by host and in-kernel conformance
  - [x] unchecked conversion — two's-complement truncation/wrap behaviour covered for all four signed widths
  - [x] comparison — typed and boxed `IComparable`/`IComparable<T>` ordering, null and wrong-type behaviour
  - [x] equality — typed/boxed equality and canonical hash behaviour
  - [x] min/max constants — canonical .NET values for all four signed integer widths
  - [x] reference-side .NET 10 conformance coverage for the completed signed-integer surface
  - [x] in-kernel/runtime conformance coverage for the completed signed-integer surface
  - [x] in-kernel/runtime signed-integer conformance uses unambiguous parenthesised negative casts so the freestanding C# gate compiles cleanly

- [x] Finish unsigned integer types
  - [x] `byte` — completed freestanding primitive surface and .NET 10 conformance coverage
  - [x] `ushort` — completed freestanding primitive surface and .NET 10 conformance coverage
  - [x] `uint` — completed freestanding primitive surface and .NET 10 conformance coverage
  - [x] `ulong` — completed freestanding primitive surface and .NET 10 conformance coverage
  - [x] parsing — `Parse`/`TryParse` for strings and spans, whitespace/sign handling, overflow/format distinction, `IParsable<T>` and `ISpanParsable<T>`
  - [x] formatting — general/decimal/hex formatting, precision, provider overloads, and `ISpanFormattable.TryFormat`
  - [x] checked conversion — checked narrowing/sign-change behaviour plus `Convert`/`IConvertible` overflow semantics
  - [x] unchecked conversion — modulo/truncation behaviour covered for all four unsigned widths
  - [x] comparison — typed and boxed `IComparable`/`IComparable<T>` ordering, null and wrong-type behaviour
  - [x] equality — typed/boxed equality and canonical hash behaviour
  - [x] min/max constants — canonical .NET values for all four unsigned integer widths
  - [x] unsigned `Decimal` conversion support for the full `UInt64` range
  - [x] reference-side .NET 10 conformance coverage for the completed unsigned-integer surface
  - [x] in-kernel/runtime conformance coverage for the completed unsigned-integer surface

- [x] Finish native integer types
  - [x] `IntPtr` — pointer-sized min/max/zero, typed equality/comparison, conversion and invariant formatting
  - [x] `UIntPtr` — pointer-sized min/max/zero, typed equality/comparison, conversion and invariant formatting
  - [x] arithmetic — Add/Subtract, offset operators, native-sized +/−/×/÷/% arithmetic, unary signed arithmetic, and increment/decrement
  - [x] comparison — typed/boxed `IComparable`, `IComparable<T>`, equality and relational operators
  - [x] conversion — pointer/native integer constructors, pointer casts, width-preserving conversions and checked 32-bit narrowing
  - [x] formatting — general/decimal/hex formatting plus `ISpanFormattable.TryFormat`
  - [x] reference-side .NET 10 conformance coverage for the completed native-integer surface
  - [x] in-kernel/runtime conformance coverage for the completed native-integer surface

- [x] Finish floating-point support
  - [x] `float` — IEEE special values, comparison/equality, parsing, formatting and conversion surface
  - [x] `double` — IEEE special values, comparison/equality, parsing, formatting and conversion surface
  - [x] NaN behaviour — detection, equality/hash normalization, ordering, parsing and formatting
  - [x] positive infinity — canonical constant, detection, parsing and formatting
  - [x] negative infinity — canonical constant, detection, parsing and formatting
  - [x] signed zero — preserved/detectable negative zero with zero equality/hash compatibility
  - [x] comparison — typed and boxed `IComparable`/`IComparable<T>` including NaN ordering
  - [x] equality — typed/boxed equality including NaN and signed-zero semantics
  - [x] parsing — string/span `Parse`/`TryParse`, sign, fraction, exponent, NaN/infinity, `IParsable<T>` and `ISpanParsable<T>`
  - [x] formatting — invariant `G`, `F` and `E`, special values, signed zero and `ISpanFormattable.TryFormat`
  - [x] conversions — `IConvertible` plus primitive `Convert`/checked integer conversion paths
  - [x] reference-side .NET 10 conformance coverage for `Single` and `Double`
  - [x] in-kernel/runtime conformance coverage for `Single` and `Double`
  - [x] BCL conformance target accounting reconciled to all 37 paired reference/kernel checks

- [x] Expand `System.Math`
  - [x] Abs
  - [x] Min
  - [x] Max
  - [x] Clamp
  - [x] Sign
  - [x] Floor
  - [x] Ceiling
  - [x] Round
  - [x] Truncate
  - [x] Sqrt
  - [x] Pow
  - [x] Exp
  - [x] Log
  - [x] Log10
  - [x] Sin
  - [x] Cos
  - [x] Tan
  - [x] Atan
  - [x] Atan2
  - [x] 0.1.6 build regression fix: `Atan` avoids C# local-name shadowing so central SDK reference compilation succeeds
  - [x] 0.1.12 conformance regression fix: restore the `clampThrows` local used by the valid `System.Math.Clamp` exception check after removing only the invalid `MathF.Clamp` requirement

- [x] Add/complete `System.MathF`
  - [x] constants (`E`, `PI`)
  - [x] Abs / Min / Max / Sign
  - [x] Floor / Ceiling / Round / Truncate
  - [x] Sqrt / Pow / Exp / Log / Log10
  - [x] Sin / Cos / Tan / Atan / Atan2
  - [x] NaN, infinity and signed-zero behaviour through the shared `System.Math` implementation
  - [x] reference-side .NET conformance coverage
  - [x] in-kernel/runtime conformance coverage
  - [x] .NET 10 API alignment: `MathF.Clamp` is not part of `System.MathF`; single-precision clamping is provided by `System.Math.Clamp(float, float, float)`

- [x] Finish `System.Convert`
  - [x] all primitive-to-primitive conversions
  - [x] string-to-primitive conversions
  - [x] primitive-to-string conversions
  - [x] overflow behaviour
  - [x] invalid conversion behaviour
  - [x] object/string bridge overloads for primitive conversion paths
  - [x] paired host-side and in-kernel conformance coverage
  - [x] 0.1.13 conformance regression fix: `System.Convert` invalid-cast result flags use distinct names and no longer collide with the earlier `Char.TryParse` output local

- [x] Finish generic comparison/equality behaviour
  - [x] `IComparable`
  - [x] `IComparable<T>`
  - [x] `IEquatable<T>`
  - [x] `Comparer<T>`
  - [x] `EqualityComparer<T>`
  - [x] nullable comparison/equality

- [x] Finish delegates
  - [x] `Action`
  - [x] `Action<T...>`
  - [x] `Func<TResult>`
  - [x] `Func<T..., TResult>`
  - [x] custom delegates
  - [x] multicast delegates
  - [x] delegate equality
  - [x] instance targets
  - [x] static targets
  - [x] `Action<T...>` and `Func<T..., TResult>` arities through 16 parameters
  - [x] `Delegate.Combine`, `Delegate.Remove`, invocation lists and single-target detection
  - [x] paired host-side and in-kernel conformance for static, instance, custom and multicast delegates
  - [x] host-side multicast-removal conformance handles the nullable delegate subtraction result without nullable-warning build failures
  - [x] .NET 10 NativeAOT `Internal.Runtime.CompilerHelpers.DelegateHelpers.GetEmptyObjectArray` compiler contract required by generated object-array delegate thunks
  - [x] .NET 10 NativeAOT compiler-known delegate initializer/open-instance contracts used for generic-virtual, interface, and generated open-instance delegate thunks

- [x] Finish `Span<T>`
  - [x] indexing
  - [x] slicing
  - [x] length
  - [x] empty spans
  - [x] array-backed spans
  - [x] copy
  - [x] fill
  - [x] clear
  - [x] equality semantics where applicable
  - [x] remaining .NET 10 public `Span<T>` type-owned surface required by the Inu .NET Profile 1 completion rule (ref/native constructors, enumeration, pinning, `ToArray`/`ToString`, `ArraySegment<T>` conversion and .NET exception/covariance rules)

- [x] Finish `ReadOnlySpan<T>`
  - [x] array, slice, single-reference and unmanaged-pointer constructors
  - [x] indexing, Length, IsEmpty and Empty
  - [x] Slice, CopyTo, TryCopyTo and ToArray
  - [x] GetEnumerator and byref-readonly Current
  - [x] GetPinnableReference
  - [x] window-identity equality/inequality plus unsupported boxed equality/hash behaviour
  - [x] array and ArraySegment<T> implicit conversions
  - [x] CastUp<TDerived> covariance
  - [x] char-specialized and generic ToString behaviour
  - [x] paired reference-side and in-kernel conformance coverage

- [x] Finish `Memory<T>`
  - [x] array and sliced-array constructors with null/range/covariance rules
  - [x] Empty, IsEmpty, Length and Span
  - [x] Slice overloads
  - [x] CopyTo and TryCopyTo
  - [x] IEquatable<Memory<T>>, object equality and compatible hashing
  - [x] Pin through System.Buffers.MemoryHandle on Inu's non-moving collector
  - [x] ToArray and char-specialized/generic ToString behaviour
  - [x] array, ArraySegment<T> and ReadOnlyMemory<T> implicit conversions
  - [x] paired reference-side and in-kernel conformance coverage

- [x] Finish `ReadOnlyMemory<T>`
  - [x] array and sliced-array constructors with null/range rules and safe read-only covariance
  - [x] Empty, IsEmpty, Length and Span
  - [x] Slice overloads
  - [x] CopyTo and TryCopyTo into Memory<T>
  - [x] IEquatable<ReadOnlyMemory<T>>, object equality and compatible hashing
  - [x] Pin through System.Buffers.MemoryHandle on Inu's non-moving collector
  - [x] ToArray and char-specialized/generic ToString behaviour
  - [x] array and ArraySegment<T> implicit conversions
  - [x] paired reference-side and in-kernel conformance coverage

---

# Priority 2 — Strings, text, parsing and formatting

- [x] Finish `System.String`
  - [x] constructors required by Inu
  - [x] Length
  - [x] indexer
  - [x] Empty
  - [x] Equals
  - [x] Compare
  - [x] CompareOrdinal
  - [x] StartsWith
  - [x] EndsWith
  - [x] Contains
  - [x] IndexOf
  - [x] LastIndexOf
  - [x] Substring
  - [x] Remove
  - [x] Insert
  - [x] Replace
  - [x] Trim
  - [x] TrimStart
  - [x] TrimEnd
  - [x] ToUpper subset
  - [x] ToLower subset
  - [x] Split
  - [x] Join
  - [x] Concat
  - [x] IsNullOrEmpty
  - [x] IsNullOrWhiteSpace
  - [x] string enumeration

- [x] Finish string interpolation runtime support

- [x] Finish composite formatting
  - [x] `{0}`
  - [x] alignment
  - [x] basic format strings
  - [x] numeric formatting subset

- [x] Finish `StringBuilder`
  - [x] Append
  - [x] AppendLine
  - [x] Insert
  - [x] Remove
  - [x] Replace
  - [x] Clear
  - [x] Length
  - [x] Capacity
  - [x] ToString
  - [x] paired reference-side and in-kernel conformance coverage, including growth and argument-error paths

- [x] Finish encoding support
  - [x] ASCII
  - [x] UTF-8
  - [x] encoding factories
  - [x] byte count
  - [x] character count
  - [x] encode
  - [x] decode
  - [x] paired reference-side and in-kernel conformance covers allocating, range, caller-buffer and span conversion paths
  - [x] Profile 1 encoding scope is deliberately ASCII + UTF-8 conversion/count/factory support; streaming `Encoder`/`Decoder`, custom fallback infrastructure, preamble/BOM policy APIs and additional code pages remain later-profile work

- [x] Define whether UTF-16 APIs belong in Profile 1
  - [x] UTF-16 encoding APIs (`UnicodeEncoding`, `Encoding.Unicode`, `Encoding.BigEndianUnicode`) are excluded from Profile 1 and deferred to a later encoding profile; this does not change the UTF-16 internal representation of `System.String`

---

# Priority 3 — Arrays, collections and enumeration

- [x] Finish arrays
  - [x] one-dimensional arrays
  - [x] bounds checks
  - [x] covariance rules supported by runtime
  - [x] cloning
  - [x] clearing
  - [x] copying
  - [x] enumeration

- [x] Finish `IEnumerable`
- [x] Finish `IEnumerator`
- [x] Finish `IEnumerable<T>`
- [x] Finish `IEnumerator<T>`
  - [x] 0.1.38 completes SZ-array enumeration through NativeAOT `SZArrayHelper`, generic/non-generic enumerator state/reset/dispose contracts, value-type boxing for non-generic array enumeration, overlap-safe array copy, clearing, cloning, bounds checks, and runtime covariance enforcement

- [x] Finish `List<T>`
  - [x] Add
  - [x] AddRange
  - [x] Remove
  - [x] RemoveAt
  - [x] Clear
  - [x] Contains
  - [x] IndexOf
  - [x] Insert
  - [x] Count
  - [x] Capacity
  - [x] indexer
  - [x] enumeration
  - [x] ToArray
  - [x] 0.1.40 completes the requested List<T> surface with self-AddRange semantics, mutation-invalidating enumerators, non-generic Current state checks, capacity/index bounds and a shared host/in-kernel conformance definition

- [x] Finish `Dictionary<TKey,TValue>`
  - [x] Add
  - [x] TryAdd
  - [x] Remove
  - [x] ContainsKey
  - [x] TryGetValue
  - [x] indexer
  - [x] Count
  - [x] Keys
  - [x] Values
  - [x] enumeration
  - [x] collision handling
  - [x] resizing
  - [x] custom equality comparer
  - [x] 0.1.42 completes the requested dictionary surface with `IEqualityComparer<TKey>`, read-only key/value views, collision-chain preservation across resize, duplicate/update semantics and mutation-invalidating enumeration

- [x] Add `HashSet<T>`
  - [x] constructors/capacity/comparer
  - [x] Add/Remove/Contains/Clear/Count
  - [x] CopyTo/TryGetValue
  - [x] collision handling/resizing
  - [x] generic/non-generic enumeration with mutation invalidation
- [x] Finish `Queue<T>`
  - [x] constructors, Enqueue/Dequeue/Peek and TryDequeue/TryPeek
  - [x] Contains/CopyTo/ToArray/Clear/Count
  - [x] EnsureCapacity/TrimExcess and FIFO enumeration with mutation invalidation
- [x] Finish `Stack<T>`
  - [x] constructors, Push/Pop/Peek and TryPop/TryPeek
  - [x] Contains/CopyTo/ToArray/Clear/Count
  - [x] EnsureCapacity/TrimExcess and LIFO enumeration with mutation invalidation
- [x] Finish `KeyValuePair<TKey,TValue>`
  - [x] constructor/Key/Value
  - [x] Deconstruct/ToString/`KeyValuePair.Create`
  - [x] shared host/in-kernel conformance for all five collection targets

- [x] Add tuples needed by ordinary C#
  - [x] `Tuple` reference tuples, `Tuple.Create` factories, item access, value equality/hash, formatting and `ITuple` indexing
  - [x] `ValueTuple` zero/generic arities, `ValueTuple.Create`, item fields, deconstruction, equality/hash, formatting and `ITuple` indexing
  - [x] language tuple support: ordinary tuple literals/types, named tuple metadata via `TupleElementNamesAttribute`, tuple equality/deconstruction, and large-tuples through `ValueTuple<T1,...,T7,TRest>.Rest`
  - [x] shared host/in-kernel tuple conformance source so compiler/runtime expectations are authored once

- [x] Add a practical LINQ subset
  - [x] Select with deferred execution
  - [x] Where with deferred execution
  - [x] First and predicate overload
  - [x] FirstOrDefault and predicate overload
  - [x] Single and predicate overload
  - [x] SingleOrDefault and predicate overload
  - [x] Any with and without predicate
  - [x] All
  - [x] Count with and without predicate
  - [x] Contains with default or explicit `IEqualityComparer<T>`
  - [x] ToArray
  - [x] ToList
  - [x] OrderBy: included; deferred stable O(n log n) merge-sort implementation using `IComparer<TKey>` with one buffered source array and one temporary array
  - [x] shared host/in-kernel LINQ conformance so expectations are authored once

---

# Priority 4 — Runtime behaviour required by normal C#

- [ ] Finish virtual dispatch
- [ ] Finish interface dispatch
- [ ] Finish generic instantiation
- [ ] Finish generic virtual methods
- [ ] Finish runtime generic dictionaries

- [ ] Finish boxing
- [ ] Finish unboxing
- [ ] Finish casts
- [ ] Finish type checks

- [ ] Finish static constructors
- [ ] Finish type initialisation ordering

- [ ] Finish exception handling
  - [ ] throw
  - [ ] catch
  - [ ] finally
  - [ ] nested EH
  - [ ] rethrow
  - [ ] exception filters if Profile 1 includes them

- [ ] Finish common exception types
  - [ ] `Exception`
  - [ ] `ArgumentException`
  - [ ] `ArgumentNullException`
  - [ ] `ArgumentOutOfRangeException`
  - [ ] `InvalidOperationException`
  - [ ] `IndexOutOfRangeException`
  - [ ] `NullReferenceException`
  - [ ] `OverflowException`
  - [ ] `NotSupportedException`
  - [ ] `IOException`

- [ ] Finish GC behaviour
  - [ ] object allocation
  - [ ] arrays
  - [ ] roots
  - [ ] static roots
  - [ ] stack roots
  - [ ] object graph tracing
  - [ ] collection
  - [ ] finalisers
  - [ ] resurrection behaviour
  - [ ] weak references if Profile 1 includes them

- [ ] Finish runtime handles
  - [ ] RuntimeTypeHandle
  - [ ] RuntimeMethodHandle
  - [ ] RuntimeFieldHandle

- [ ] Finish primitive/ABI/layout conformance

---

# Priority 5 — Time and utility types

- [ ] Add/finish `TimeSpan`
- [ ] Add/finish `DateTime`
- [ ] Decide Profile 1 timezone scope
- [ ] Add `Guid`
- [ ] Add `Random`
- [ ] Add basic `Environment`
  - [ ] processor count
  - [ ] tick count
  - [ ] newline
  - [ ] OS/runtime information where appropriate

---

# Priority 6 — System.IO over Inu filesystem interfaces

The API should look familiar to .NET developers while remaining backed by the OS-selected filesystem implementation.

- [ ] Add/finish `System.IO.File`
  - [ ] Exists
  - [ ] ReadAllText
  - [ ] ReadAllBytes
  - [ ] WriteAllText
  - [ ] WriteAllBytes
  - [ ] Copy
  - [ ] Move
  - [ ] Delete
  - [ ] Create

- [ ] Add/finish `System.IO.Directory`
  - [ ] Exists
  - [ ] CreateDirectory
  - [ ] Delete
  - [ ] Move
  - [ ] GetFiles
  - [ ] GetDirectories
  - [ ] GetFileSystemEntries
  - [ ] EnumerateFiles
  - [ ] EnumerateDirectories

- [ ] Add/finish `Path`
  - [ ] Combine
  - [ ] GetFileName
  - [ ] GetDirectoryName
  - [ ] GetExtension
  - [ ] ChangeExtension
  - [ ] IsPathRooted
  - [ ] respect the OS-selected path separator
  - [ ] respect case sensitivity policy
  - [ ] respect invalid-character policy

- [ ] Add basic stream model
  - [ ] `Stream`
  - [ ] `FileStream`
  - [ ] `MemoryStream`
  - [ ] `StreamReader`
  - [ ] `StreamWriter`

- [ ] Ensure IO APIs resolve through Inu interfaces/Get-Set-Event rather than bypassing OS policy

---

# Priority 7 — Threading, scheduling and processes

- [ ] Add practical `System.Threading.Thread`
  - [ ] Start
  - [ ] Sleep
  - [ ] Yield
  - [ ] CurrentThread
  - [ ] managed thread identity

- [ ] Add synchronisation primitives
  - [ ] `Monitor`
  - [ ] `lock` support verification
  - [ ] `Interlocked`
  - [ ] `Volatile`
  - [ ] `SpinLock` if useful

- [ ] Decide Profile 1 task model
  - [ ] `Task`
  - [ ] `Task<T>`
  - [ ] async/await runtime support
  - [ ] cancellation

- [ ] Add .NET-shaped process APIs over Inu process interfaces
  - [ ] current process
  - [ ] process ID
  - [ ] start process
  - [ ] wait
  - [ ] terminate
  - [ ] process information

- [ ] Keep actual process control behind Get/Set/Event

---

# Priority 8 — Console and normal developer-facing APIs

- [ ] Complete `System.Console`
  - [ ] Write
  - [ ] WriteLine
  - [ ] Read
  - [ ] ReadLine
  - [ ] ReadKey
  - [ ] Clear
  - [ ] cursor APIs where selected console supports them
  - [ ] foreground/background colour where policy permits
  - [ ] efficient buffered output rather than character-at-a-time syscalls

- [x] Ensure Release/No Debug has no expensive per-syscall tracing

- [x] Keep Debug tracing explicitly opt-in

---

# Priority 9 — Networking

Only expose networking APIs when the selected OS architecture contains the required networking components.

- [ ] Add `System.Net` subset
- [ ] Add `System.Net.Sockets` subset
  - [ ] Socket
  - [ ] AddressFamily
  - [ ] SocketType
  - [ ] ProtocolType
  - [ ] bind
  - [ ] listen
  - [ ] accept
  - [ ] connect
  - [ ] send
  - [ ] receive
  - [ ] close

- [ ] Add IP address types
- [ ] Add endpoint types
- [ ] Add DNS support when selected network stack provides it

- [ ] Have Kath detect missing networking dependencies from API use

---

# Priority 10 — Kath IntelliSense and .NET developer experience

- [ ] Make Inu reference assemblies authoritative for IntelliSense

- [ ] Completion for supported `System.*` APIs

- [ ] Signature help

- [ ] overload resolution

- [ ] parameter hints

- [ ] XML/API documentation

- [ ] go-to-definition

- [ ] find references

- [ ] rename support

- [ ] compiler diagnostics shown immediately in editor

- [ ] unsupported API diagnostics before build

Example:

```text
System.Reflection.Emit is not available in Inu .NET Profile 1.
```

- [ ] dependency-aware API diagnostics

Example:

```text
System.Net.Sockets.Socket requires a networking component.
```

- [ ] offer a recommended dependency automatically

- [ ] allow coder to choose another implementation

- [ ] allow coder to leave dependency unresolved

---

# Priority 11 — Ordinary .NET-style project experience

- [ ] Make Build hide NativeAOT/ILC plumbing by default

- [ ] Make Run hide linker/image-builder plumbing by default

- [ ] Make Debug expose only useful debugging controls

- [ ] Keep advanced build details available on demand

- [ ] Normal workflow should be:
  - [ ] create/open OS
  - [ ] write C#
  - [ ] press Run
  - [ ] OS boots

- [ ] Make references feel like normal project references

- [ ] Ensure central Inu reference libraries are never copied into generated OS projects unless explicitly materialised

- [ ] Preserve the single-source ownership model

- [x] Automatically refresh SDK-owned dependencies when an OS is opened

- [x] Keep manual **Refresh** menu option

- [x] Never overwrite coder-owned source during refresh

---

# Priority 12 — Define Inu .NET Profile 1

- [ ] Create `docs/Inu-DotNet-Profile-1.md`

- [ ] List every supported namespace

- [ ] List every supported type

- [ ] List every supported public member

- [ ] Mark:
  - [ ] fully compatible
  - [ ] intentionally reduced
  - [ ] Inu-specific behaviour
  - [ ] unsupported

- [ ] Define required runtime capabilities per API

- [ ] Define optional component dependencies per API

- [ ] Generate machine-readable Profile 1 manifest

- [ ] Make Kath consume that manifest

- [ ] Make conformance tests consume that manifest

- [ ] Fail CI/build validation if:
  - [ ] profile declares a member that reference assemblies do not expose
  - [ ] reference assemblies expose an undeclared member
  - [ ] conformance coverage is missing for a declared required member

---

# Priority 13 — Conformance infrastructure

For every supported API:

- [ ] reference-side `Inu.DotNetConformance.Tests` test

- [ ] runtime/in-kernel test when runtime semantics are involved

- [ ] compare expected behaviour against normal .NET where practical

- [ ] verify exception types

- [ ] verify boundary cases

- [ ] verify null behaviour

- [ ] verify overflow behaviour

- [ ] verify generic behaviour

- [ ] verify Release/NativeAOT behaviour

- [ ] keep heavy in-kernel conformance explicit-only

- [ ] keep automatic SDK-change conformance host-side

- [ ] split fingerprints by subsystem so unrelated changes do not force unnecessary test/build work

---

# Priority 14 — Build-performance cleanup

- [x] Ensure version-only changes never invalidate userland NativeAOT outputs

- [ ] Cache each command independently

- [ ] Cache Shell independently

- [ ] Cache GUI applications independently

- [ ] Recompile only affected applications

- [ ] Avoid unnecessary restore work

- [x] Avoid rebuilding unchanged host tools

- [x] Preserve accelerator selection through Make OS → target → Run/Debug
- [x] Reject mixed `VERSION` / `Inu/VERSION` / `Kath/VERSION` trees before version propagation
- [x] Verify installed root/Inu/Kath version mirrors after clean-source installation
- [x] Include the Kath release version in the launcher cache identity
- [x] Explicitly stamp Kath launcher `Version`, `AssemblyVersion`, and `FileVersion` from `Kath/VERSION`

- [x] Default emulator acceleration to Auto

- [x] Windows: WHPX → TCG fallback

- [x] Linux: KVM → TCG fallback

- [x] macOS: HVF → TCG fallback

---

# Priority 15 — Filesystem and command consistency

- [x] Maintain kernel filesystem namespace/index in background

- [x] Update namespace immediately on:
  - [x] create
  - [x] delete
  - [x] mkdir
  - [x] rmdir
  - [x] rename
  - [x] move
  - [x] mount
  - [x] unmount

- [x] `dir` presentation:
  - [x] current directory heading
  - [x] directories first
  - [x] files second
  - [x] alphabetical order
  - [x] names rather than repeated full paths

- [x] command and help files always staged as pairs

- [x] missing command help fails image build

- [x] no help file for a command that is not present

- [x] command discovery uses maintained index

- [x] command launch avoids reparsing immutable executables unnecessarily

---

# Priority 16 — Higher libraries after Profile 1 foundation

Do not start these until the primitive/runtime, collections, strings, IO and IntelliSense layers are dependable.

- [ ] `System.Diagnostics` subset
- [ ] `System.Globalization` subset
- [ ] additional `System.Text`
- [ ] additional LINQ
- [ ] richer networking
- [ ] richer threading/tasks
- [ ] selected reflection read-only metadata APIs if genuinely needed
- [ ] cryptography subset if required by future OS/application work

---

# Definition of Done — Inu .NET Profile 1

Profile 1 is complete when an ordinary C# developer can:

- [ ] create an Inu application in Kath;
- [ ] use the documented Profile 1 `System.*` APIs without Inu-specific boilerplate;
- [ ] receive normal IntelliSense and API documentation;
- [ ] compile using NativeAOT without manually understanding ILC/linker/runtime plumbing;
- [ ] run the application as an isolated userland process;
- [ ] use collections, strings, formatting, exceptions, generics, delegates and common IO naturally;
- [ ] get a clear editor diagnostic for unsupported APIs;
- [ ] have Kath resolve required OS components where an API depends upon filesystem/network/process/etc. support;
- [ ] press Run and have the OS boot successfully;
- [ ] rely on every advertised Profile 1 API being covered by conformance tests.

---

# Recommended immediate implementation order

- [ ] **1. Primitive/runtime completion**
- [ ] **2. String/text/parsing/formatting**
- [ ] **3. Collections/enumeration**
- [ ] **4. Runtime language semantics**
- [ ] **5. System.IO**
- [ ] **6. Console/process/threading APIs**
- [ ] **7. Kath IntelliSense/profile diagnostics**
- [ ] **8. Inu .NET Profile 1 specification**
- [ ] **9. Networking**
- [ ] **10. Higher libraries**

