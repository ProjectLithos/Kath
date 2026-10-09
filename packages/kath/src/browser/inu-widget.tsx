import { inject, injectable, postConstruct } from 'inversify';
import { MessageService } from '@theia/core/lib/common/message-service';
import { ConfirmDialog } from '@theia/core/lib/browser/dialogs';
import URI from '@theia/core/lib/common/uri';
import { BaseWidget } from '@theia/core/lib/browser/widgets/widget';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { Message } from '@lumino/messaging';
import {
    InuOperatingSystem,
    InuProjectConfiguration,
    InuProjectService,
    KernelArchitecture,
    KathStartupModel,
    KathExecutableFormat,
    InuQemuAccelerator
} from '../common/inu-protocol';

export const INU_WIDGET_ID = 'inu.project.configurator';
export const INU_EXPLICIT_WORKSPACE_OPEN = 'inu.explicitWorkspaceOpen';

type Page = 'startup' | 'configuration';
type Option = readonly [value: string, label: string];

@injectable()
export class InuWidget extends BaseWidget {
    static readonly ID = INU_WIDGET_ID;
    static readonly LABEL = 'Kath&Inu';

    @inject(InuProjectService) protected readonly projectService!: InuProjectService;
    @inject(MessageService) protected readonly messages!: MessageService;
    @inject(WorkspaceService) protected readonly workspaceService!: WorkspaceService;

    protected configuration: InuProjectConfiguration = this.createDefaultConfiguration();
    protected creating = false;
    protected generationPercent = 0;
    protected generationStatus = '';
    protected generationProgressTimer: number | undefined;
    protected reconfiguringProjectPath: string | undefined;
    protected page: Page = 'startup';
    protected operatingSystems: InuOperatingSystem[] = [];
    protected loadingSystems = false;
    protected startupScanStarted = false;

    @postConstruct()
    protected init(): void {
        this.id = InuWidget.ID;
        this.title.label = InuWidget.LABEL;
        this.title.caption = 'Create and compose a Kath&Inu operating system';
        this.title.closable = true;
        this.addClass('inu-widget');
        this.node.tabIndex = 0;
        this.renderContent();
    }

    protected override onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        this.renderContent();
        if (!this.startupScanStarted) {
            this.startupScanStarted = true;
            window.setTimeout(() => void this.refreshOperatingSystems(), 0);
        }
    }

    protected createDefaultConfiguration(): InuProjectConfiguration {
        return {
            schemaVersion: 9,
            name: 'MyOs',
            author: 'The DCL Group',
            location: '',
            logoPath: '',
            kernelArchitecture: 'monolithic',
            targetArchitecture: 'x86_64',
            bootArchitecture: 'uefi',
            executableFormats: ['elf64', 'pe64'],
            startupModel: 'cli',
            hardwareSupport: ['pci', 'acpi', 'serial-16550', 'nvme', 'ahci', 'usb-xhci', 'usb-hid-keyboard', 'usb-hid-mouse', 'uefi-gop'],
            customExecutionPlacements: {},

            // Transitional implementation settings. Kath derives these from the
            // architectural choices above; they are intentionally not exposed as
            // primary design decisions in the 0.0.1 configurator.
            qemuCpuCount: 4,
            qemuAccelerator: 'auto',
            memorySystem: 'paged',
            scheduler: 'preemptive',
            processSupport: 'processes',
            syscallModel: 'inu',
            smp: true,
            cpuRoles: { kernel: '0', userland: 'all', gui: 'all', drivers: 'all', interrupts: 'all', networking: 'all', storage: 'all', realtime: 'all', background: 'all' },
            interruptModel: 'apic',
            timers: ['tsc', 'hpet', 'local-apic', 'rtc'],
            drivers: [],
            storageControllers: [],
            filesystem: 'none',
            networkStack: 'none',
            networkDrivers: [],
            input: [],
            graphics: [],
            audio: 'none',
            userland: true,
            shell: 'inu-shell',
            gui: 'none',
            guiDesktopPath: '/BIN/INU-DESKTOP.EXE',
            guiLoginPath: '/BIN/INU-LOGIN.EXE',
            debugging: ['serial-log', 'kernel-diagnostics'],
            testing: [],
            virtualisation: 'guest',
            safetyProfile: 'general',
            safetyOptions: []
        };
    }

    protected deriveImplementationConfiguration(configuration: InuProjectConfiguration): InuProjectConfiguration {
        const selected = new Set(configuration.hardwareSupport);
        const startup = configuration.startupModel;
        const customExecutionPlacements = { ...(configuration.customExecutionPlacements ?? {}) };
        if (configuration.kernelArchitecture === 'custom') {
            for (const capability of configuration.hardwareSupport) {
                const key = `hardware:${capability}`;
                if (customExecutionPlacements[key] !== 'kernel' && customExecutionPlacements[key] !== 'userland')
                    customExecutionPlacements[key] = 'userland';
            }
        }
        return {
            ...configuration,
            schemaVersion: 9,
            customExecutionPlacements,
            targetArchitecture: 'x86_64',
            bootArchitecture: 'uefi',
            drivers: ['pci','acpi','serial-16550','virtio-console','virtio-rng','usb-xhci','usb-ehci'].filter(value => selected.has(value)),
            storageControllers: ['virtio-block','nvme','ahci'].filter(value => selected.has(value)),
            networkDrivers: ['virtio-net','e1000','rtl8168'].filter(value => selected.has(value)),
            input: ['ps2-keyboard','ps2-mouse','usb-hid-keyboard','usb-hid-mouse'].filter(value => selected.has(value)),
            graphics: ['uefi-gop','generic-framebuffer','virtio-gpu'].filter(value => selected.has(value)),
            audio: selected.has('hda') ? 'hda' : selected.has('ac97') ? 'ac97' : 'none',
            networkStack: ['virtio-net','e1000','rtl8168'].some(value => selected.has(value)) ? 'dual-stack' : 'none',
            userland: startup !== 'none',
            shell: startup === 'cli' || startup === 'cli-gui' ? 'inu-shell' : 'none',
            gui: startup === 'gui' || startup === 'cli-gui' ? 'desktop' : 'none'
        };
    }

    protected renderContent(): void {
        this.node.replaceChildren();
        if (this.page === 'startup') this.renderStartup();
        else this.renderConfiguration();
        if (this.creating) {
            const overlay = this.element('div', 'inu-generation-overlay');
            const panel = this.element('div', 'inu-generation-panel');
            panel.appendChild(this.element('div', 'inu-generation-title', this.reconfiguringProjectPath ? 'Applying OS architecture…' : 'Generating the OS…'));
            panel.appendChild(this.element('div', 'inu-generation-percent', `${this.generationPercent}%`));
            const track = this.element('div', 'inu-generation-track');
            const fill = this.element('div', 'inu-generation-fill');
            fill.style.width = `${Math.max(0, Math.min(100, this.generationPercent))}%`;
            track.appendChild(fill);
            panel.appendChild(track);
            panel.appendChild(this.element('div', 'inu-generation-message', this.generationStatus || 'Composing Boot, Kernel and Userland source…'));
            overlay.appendChild(panel);
            this.node.appendChild(overlay);
        }
    }

    protected element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
    }

    protected button(text: string, className: string, click: () => void): HTMLButtonElement {
        const button = this.element('button', className, text);
        button.type = 'button';
        button.addEventListener('click', click);
        return button;
    }

    protected renderStartup(): void {
        const page = this.element('div', 'inu-page inu-start-page');
        const card = this.element('div', 'inu-start-card');
        card.appendChild(this.element('h1', undefined, 'Kath&Inu'));
        card.appendChild(this.element('p', undefined, 'Compose an editable operating system from Inu source components.'));
        card.appendChild(this.button('Create Operating System', 'theia-button main', () => void this.beginNewOperatingSystem()));

        const existing = this.element('section', 'inu-existing');
        existing.appendChild(this.element('h2', undefined, 'Open Existing OS'));
        if (this.loadingSystems) existing.appendChild(this.element('p', undefined, 'Looking for Kath&Inu operating systems…'));
        else if (!this.operatingSystems.length) existing.appendChild(this.element('p', undefined, 'No registered operating systems were found.'));
        else {
            const list = this.element('div', 'inu-os-list');
            for (const os of this.operatingSystems) {
                const item = this.element('div', 'inu-os-item');
                const controls = this.element('div', 'inu-os-item-controls');
                controls.appendChild(this.button('Remove from list', 'theia-button secondary inu-os-remove', () => void this.removeOperatingSystemFromList(os)));
                controls.appendChild(this.button('Delete source code', 'theia-button secondary inu-os-delete', () => void this.deleteOperatingSystemSource(os)));
                item.appendChild(controls);
                const entry = this.button('', 'inu-os-entry', () => void this.openOperatingSystem(os));
                entry.appendChild(this.element('strong', undefined, os.name));
                entry.appendChild(this.element('span', undefined, `ID: ${os.id}`));
                entry.appendChild(this.element('span', undefined, `Location: ${os.location}`));
                item.appendChild(entry);
                list.appendChild(item);
            }
            existing.appendChild(list);
        }
        existing.appendChild(this.button('Refresh list', 'theia-button secondary', () => void this.refreshOperatingSystems()));
        card.appendChild(existing);
        page.appendChild(card);
        this.node.appendChild(page);
    }

    protected renderConfiguration(): void {
        const c = this.configuration;
        const page = this.element('div', 'inu-page');
        const card = this.element('div', 'inu-card inu-card-wide');
        card.appendChild(this.element('h1', undefined, this.reconfiguringProjectPath ? `Reconfigure ${c.name}` : 'Create Kath&Inu OS'));
        card.appendChild(this.element('p', undefined, 'Kath asks for architecture and intent; implementation dependencies are resolved automatically.'));

        card.appendChild(this.configurationActions());

        const identity = this.fieldset('1. OS identity');
        identity.appendChild(this.reconfiguringProjectPath ? this.readonlyPath('OS name', c.name) : this.textInput('OS name', c.name, value => c.name = value));
        identity.appendChild(this.textInput('Author', c.author, value => c.author = value));
        identity.appendChild(this.textInput('Optional BMP logo', c.logoPath, value => c.logoPath = value.trim()));
        identity.appendChild(this.reconfiguringProjectPath ? this.readonlyPath('OS folder', this.reconfiguringProjectPath) : this.textInput('Save operating systems in', c.location, value => c.location = value));
        card.appendChild(identity);

        const platform = this.fieldset('2. Platform');
        platform.appendChild(this.readonlyPath('Architecture', 'x64'));
        platform.appendChild(this.readonlyPath('Boot method', 'UEFI'));
        platform.appendChild(this.selectInput('QEMU accelerator', c.qemuAccelerator, [
            ['auto','Auto (recommended; use host acceleration with TCG fallback)'],
            ['whpx','WHPX (Windows Hypervisor Platform)'],
            ['kvm','KVM (Linux)'],
            ['hvf','HVF (macOS Hypervisor Framework)'],
            ['tcg','TCG (software emulation)']
        ], value => c.qemuAccelerator = value as InuQemuAccelerator));
        platform.appendChild(this.element('div', 'inu-field-help', 'After UEFI hand-off, the kernel discovers CPU, memory, ACPI, PCI/PCIe and supported hardware at runtime.'));
        card.appendChild(platform);

        const kernel = this.fieldset('3. Kernel model');
        kernel.appendChild(this.selectInput('Kernel type', c.kernelArchitecture, [
            ['monolithic','Monolithic'], ['microkernel','Microkernel'], ['hybrid','Hybrid'], ['custom','Custom']
        ], value => c.kernelArchitecture = value as KernelArchitecture));
        card.appendChild(kernel);

        const executables = this.fieldset('4. Executables');
        executables.appendChild(this.multiInput('Executable formats', c.executableFormats, [
            ['elf64','ELF64'], ['pe64','PE32+/PE64'], ['flat','Flat binary'], ['custom','Custom format']
        ]));
        card.appendChild(executables);

        const startup = this.fieldset('5. Startup environment');
        startup.appendChild(this.selectInput('Startup', c.startupModel, [
            ['none','Kernel only'], ['cli','CLI'], ['gui','GUI'], ['cli-gui','CLI that can launch GUI'], ['custom','Custom']
        ], value => c.startupModel = value as KathStartupModel));
        card.appendChild(startup);

        const hardware = this.fieldset('6. Hardware support');
        hardware.appendChild(this.element('div', 'inu-field-help', 'Select what the OS should know how to use. At runtime, hardware is discovered and only matching drivers are activated.'));
        hardware.appendChild(this.multiInput('Platform / core', c.hardwareSupport, [
            ['pci','PCI / PCIe'], ['acpi','ACPI'], ['serial-16550','16550 serial'], ['virtio-console','VirtIO console'], ['virtio-rng','VirtIO RNG']
        ]));
        hardware.appendChild(this.multiInput('Storage', c.hardwareSupport, [
            ['nvme','NVMe'], ['ahci','AHCI / SATA'], ['virtio-block','VirtIO block']
        ]));
        hardware.appendChild(this.multiInput('USB / input', c.hardwareSupport, [
            ['usb-xhci','USB xHCI'], ['usb-ehci','USB EHCI'], ['usb-hid-keyboard','USB HID keyboard'], ['usb-hid-mouse','USB HID mouse'], ['ps2-keyboard','PS/2 keyboard'], ['ps2-mouse','PS/2 mouse']
        ]));
        hardware.appendChild(this.multiInput('Graphics', c.hardwareSupport, [
            ['uefi-gop','UEFI GOP framebuffer'], ['generic-framebuffer','Generic framebuffer'], ['virtio-gpu','VirtIO GPU']
        ]));
        hardware.appendChild(this.multiInput('Network', c.hardwareSupport, [
            ['virtio-net','VirtIO net'], ['e1000','Intel E1000'], ['rtl8168','Realtek RTL8168/8111']
        ]));
        card.appendChild(hardware);

        if (c.kernelArchitecture === 'custom') {
            const placement = this.fieldset('7. Custom execution placement');
            placement.appendChild(this.element('div', 'inu-field-help',
                'Communication, process control and syscalls remain kernel-resident. Choose whether each selected post-boot hardware mechanism runs in the kernel or in userland.'));
            for (const capability of c.hardwareSupport) {
                const key = `hardware:${capability}`;
                const current = c.customExecutionPlacements?.[key] ?? 'userland';
                placement.appendChild(this.selectInput(capability, current, [
                    ['kernel','Kernel'], ['userland','Userland']
                ], value => c.customExecutionPlacements[key] = value as 'kernel' | 'userland'));
            }
            card.appendChild(placement);
        }

        card.appendChild(this.configurationActions());
        const note = this.element('div', 'inu-note');
        note.textContent = 'Generated source is partitioned by execution area: Boot, Kernel and Userland. SDK-managed implementation folders are hidden from the normal source explorer; the OS-named coder areas remain visible and are never silently overwritten.';
        card.appendChild(note);
        page.appendChild(card);
        this.node.appendChild(page);
    }

    protected fieldset(legendText: string): HTMLFieldSetElement {
        const fieldset = this.element('fieldset');
        fieldset.appendChild(this.element('legend', undefined, legendText));
        return fieldset;
    }

    protected textInput(label: string, value: string, update: (value: string) => void): HTMLDivElement {
        const field = this.element('div', 'inu-field');
        field.appendChild(this.element('label', undefined, label));
        const input = this.element('input', 'theia-input'); input.type = 'text'; input.value = value;
        input.addEventListener('input', () => update(input.value)); field.appendChild(input); return field;
    }

    protected readonlyPath(label: string, value: string): HTMLDivElement {
        const field = this.element('div', 'inu-field'); field.appendChild(this.element('label', undefined, label));
        field.appendChild(this.element('div', 'inu-readonly-path', value)); return field;
    }

    protected selectInput(label: string, value: string, options: Option[], update: (value: string) => void): HTMLDivElement {
        const field = this.element('div', 'inu-field'); field.appendChild(this.element('label', undefined, label));
        const select = this.element('select', 'theia-select');
        for (const [optionValue, optionLabel] of options) { const option = this.element('option', undefined, optionLabel); option.value = optionValue; option.selected = optionValue === value; select.appendChild(option); }
        select.addEventListener('change', () => update(select.value)); field.appendChild(select); return field;
    }

    protected multiInput<T extends string>(label: string, values: T[], options: readonly (readonly [T, string])[]): HTMLDivElement {
        const field = this.element('div', 'inu-field'); field.appendChild(this.element('label', undefined, label));
        const grid = this.element('div', 'inu-check-grid');
        for (const [optionValue, optionLabel] of options) {
            const wrapper = this.element('label', 'inu-check'); const input = this.element('input'); input.type = 'checkbox'; input.checked = values.includes(optionValue);
            input.addEventListener('change', () => { const index = values.indexOf(optionValue); if (input.checked && index < 0) values.push(optionValue); if (!input.checked && index >= 0) values.splice(index, 1); });
            wrapper.append(input, document.createTextNode(optionLabel)); grid.appendChild(wrapper);
        }
        field.appendChild(grid); return field;
    }

    protected configurationActions(): HTMLDivElement {
        const actions = this.element('div', 'inu-actions');
        actions.appendChild(this.button(this.reconfiguringProjectPath ? 'Cancel' : 'Back', 'theia-button secondary', () => { if (this.reconfiguringProjectPath) this.close(); else { this.page = 'startup'; this.renderContent(); } }));
        const action = this.button(this.creating ? `${this.reconfiguringProjectPath ? 'Applying' : 'Generating'}… ${this.generationPercent}%` : (this.reconfiguringProjectPath ? 'Apply Architecture' : 'Create Kernel/OS'), 'theia-button main', () => void this.createProject());
        action.disabled = this.creating; actions.appendChild(action);
        if (this.generationStatus) actions.appendChild(this.element('div', 'inu-generation-status', this.generationStatus));
        return actions;
    }

    protected async beginNewOperatingSystem(): Promise<void> {
        this.reconfiguringProjectPath = undefined; this.generationStatus = ''; this.configuration = this.createDefaultConfiguration();
        try { this.configuration.location = await this.projectService.getDefaultOperatingSystemLocation(); } catch { this.configuration.location = ''; }
        try { this.configuration.name = await this.projectService.nextDefaultOperatingSystemName('MyOs', this.configuration.location); } catch { }
        this.page = 'configuration'; this.renderContent();
    }

    async beginReconfigureOperatingSystem(projectPath: string): Promise<boolean> {
        try {
            const result = await this.projectService.readProjectConfiguration(projectPath);
            if (!result.success || !result.configuration || !result.projectPath) { await this.messages.error(`Could not load Kath&Inu configuration: ${result.error ?? 'Unknown error'}`); return false; }
            this.configuration = { ...result.configuration, executableFormats: [...result.configuration.executableFormats], hardwareSupport: [...result.configuration.hardwareSupport], customExecutionPlacements: { ...(result.configuration.customExecutionPlacements ?? {}) } };
            this.reconfiguringProjectPath = result.projectPath; this.page = 'configuration'; this.renderContent(); return true;
        } catch (error) { await this.messages.error(`Could not load Kath&Inu configuration: ${error instanceof Error ? error.message : String(error)}`); return false; }
    }

    protected async refreshOperatingSystems(): Promise<void> {
        this.loadingSystems = true; this.renderContent();
        try { this.operatingSystems = await this.projectService.listOperatingSystems(); }
        catch (error) { this.operatingSystems = []; await this.messages.error(`Could not scan registered OS locations: ${error instanceof Error ? error.message : String(error)}`); }
        finally { this.loadingSystems = false; this.renderContent(); }
    }

    protected async openOperatingSystem(os: InuOperatingSystem): Promise<void> {
        const refreshed = await this.projectService.refreshOperatingSystem(os.path);
        if (!refreshed.success) {
            await this.messages.error(`Could not refresh ${os.name} before opening: ${refreshed.error ?? 'Unknown error'}`);
            return;
        }
        window.sessionStorage.setItem(INU_EXPLICIT_WORKSPACE_OPEN, os.uri);
        await this.workspaceService.open(new URI(os.uri), { preserveWindow: true });
    }

    protected async removeOperatingSystemFromList(os: InuOperatingSystem): Promise<void> {
        const result = await this.projectService.removeOperatingSystemFromList(os.id); if (!result.success) { await this.messages.error(result.error ?? 'Could not remove operating system.'); return; } await this.refreshOperatingSystems();
    }

    protected async deleteOperatingSystemSource(os: InuOperatingSystem): Promise<void> {
        const confirmation = await new ConfirmDialog({
            title: 'Delete Source Code',
            msg: `Delete all source code for ${os.name}?\n\nID: ${os.id}\nLocation: ${os.location}\n\nThis permanently deletes that registered source location.`,
            ok: 'Delete Source Code',
            cancel: 'Cancel'
        }).open();
        if (!confirmation) return;
        const result = await this.projectService.deleteOperatingSystemSource(os.id); if (!result.success) { await this.messages.error(result.error ?? 'Could not delete operating system.'); return; }
        await this.messages.info(`Source code deleted: ${result.projectPath ?? os.location}`);
        await this.refreshOperatingSystems();
    }

    protected startGenerationProgressPolling(): void {
        this.stopGenerationProgressPolling();
        const poll = async () => { try { const percent = await this.projectService.getProjectGenerationProgress(); if (this.creating && percent !== this.generationPercent) { this.generationPercent = Math.max(0, Math.min(100, Math.trunc(percent))); this.renderContent(); } } catch { } };
        void poll(); this.generationProgressTimer = window.setInterval(() => void poll(), 100);
    }

    protected stopGenerationProgressPolling(): void { if (this.generationProgressTimer !== undefined) { window.clearInterval(this.generationProgressTimer); this.generationProgressTimer = undefined; } }

    protected async createProject(): Promise<void> {
        if (this.creating) return;
        const c = this.deriveImplementationConfiguration({ ...this.configuration, executableFormats: [...this.configuration.executableFormats], hardwareSupport: [...this.configuration.hardwareSupport], customExecutionPlacements: { ...(this.configuration.customExecutionPlacements ?? {}) } });
        c.name = c.name.trim(); c.author = c.author.trim() || 'The DCL Group'; c.location = c.location.trim();
        if (!c.name) { await this.messages.error('Enter an operating system name.'); return; }
        if (!this.reconfiguringProjectPath && !c.location) { await this.messages.error('Choose the folder in which to save the operating system.'); return; }
        if (!c.executableFormats.length) { await this.messages.error('Select at least one executable format.'); return; }
        this.creating = true; this.generationPercent = 0; this.generationStatus = 'Composing Boot, Kernel and Userland source…'; this.renderContent();
        // Allow the browser to paint the visible generation state before the RPC starts.
        await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
        try {
            const generation = this.reconfiguringProjectPath ? this.projectService.reconfigureProject(this.reconfiguringProjectPath, c) : this.projectService.createProject(c);
            this.startGenerationProgressPolling(); const result = await generation;
            if (!result.success) { this.generationStatus = `Generation failed: ${result.error ?? 'Unknown error'}`; await this.messages.error(this.generationStatus); return; }
            this.configuration = c; this.generationPercent = 100; this.generationStatus = `OS generated at ${result.projectPath ?? this.reconfiguringProjectPath}.`;
            if (!this.reconfiguringProjectPath) {
                await this.refreshOperatingSystems();
                if (result.projectPath) {
                    const normalizePath = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
                    const generatedPath = normalizePath(result.projectPath);
                    const os = this.operatingSystems.find(item =>
                        normalizePath(item.path) === generatedPath ||
                        normalizePath(item.location) === generatedPath);
                    if (os) {
                        this.generationStatus = `OS generated at ${result.projectPath}. Opening source workspace…`;
                        this.renderContent();
                        await this.openOperatingSystem(os);
                    } else {
                        await this.messages.error(`OS source was generated at ${result.projectPath}, but Kath could not resolve its registered workspace.`);
                    }
                }
            }
        } catch (error) { this.generationStatus = `Generation failed: ${error instanceof Error ? error.message : String(error)}`; await this.messages.error(this.generationStatus); }
        finally { this.creating = false; this.stopGenerationProgressPolling(); this.renderContent(); }
    }
}
