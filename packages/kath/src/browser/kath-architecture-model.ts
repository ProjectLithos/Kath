import { InuProjectConfiguration } from '../common/inu-protocol';

export type KathArchitectureArea = 'Boot' | 'Kernel' | 'Userland';
export type KathSourceRole = 'Provided' | 'OS';

export interface KathArchitectureComponent {
    id: string;
    name: string;
    area: KathArchitectureArea;
    role: KathSourceRole;
    category: string;
    description: string;
    provides: string[];
    requires: string[];
    sourceHint?: string;
    origin: 'Inu' | 'OS';
    sdkLanguage: 'C#' | 'OS-owned';
}

function placement(configuration: InuProjectConfiguration, category: 'driver'|'service'|'runtime', key?: string): KathArchitectureArea {
    if (category === 'runtime') return 'Kernel';
    if (configuration.kernelArchitecture === 'monolithic') return 'Kernel';
    if (configuration.kernelArchitecture === 'microkernel') return 'Userland';
    if (configuration.kernelArchitecture === 'hybrid') return category === 'driver' ? 'Kernel' : 'Userland';
    if (configuration.kernelArchitecture === 'custom' && key)
        return configuration.customExecutionPlacements?.[key] === 'kernel' ? 'Kernel' : 'Userland';
    return 'Userland';
}

export function buildKathArchitecture(configuration: InuProjectConfiguration): KathArchitectureComponent[] {
    const result: KathArchitectureComponent[] = [];
    const add=(component:KathArchitectureComponent)=>result.push(component);
    add({ id:'boot', name:'UEFI Boot', area:'Boot', role:'Provided', category:'Boot', description:'Kath&Inu supplied x64 UEFI boot and firmware hand-off.', provides:['IBootEntry'], requires:[], sourceHint:'Boot/Provided/Uefi/', origin:'Inu', sdkLanguage:'C#' });
    add({ id:'boot-os', name:`${configuration.name} Boot`, area:'Boot', role:'OS', category:'Boot', description:'Coder-owned boot customisation source.', provides:[], requires:['IBootEntry'], sourceHint:`Boot/${configuration.name}/`, origin:'OS', sdkLanguage:'OS-owned' });
    add({ id:'kernel-runtime', name:`${configuration.kernelArchitecture} kernel`, area:'Kernel', role:'Provided', category:'Runtime', description:'Working kernel mechanisms selected by the OS architecture.', provides:['IKernel'], requires:[], sourceHint:'Kernel/Provided/', origin:'Inu', sdkLanguage:'C#' });
    add({ id:'kernel-os', name:`${configuration.name} Kernel`, area:'Kernel', role:'OS', category:'Kernel', description:'Coder-owned Kernel.cs and additional kernel source.', provides:[], requires:['IKernel'], sourceHint:`Kernel/${configuration.name}/Kernel.cs`, origin:'OS', sdkLanguage:'OS-owned' });
    for(const hardware of configuration.hardwareSupport){
        const area=placement(configuration,'driver',`hardware:${hardware}`);
        add({ id:`hardware:${hardware}`, name:hardware, area, role:'Provided', category:'Drivers', description:`Selected hardware support; activated only when matching hardware is discovered.`, provides:['IDevice'], requires:[], sourceHint:`${area}/Provided/Drivers/`, origin:'Inu', sdkLanguage:'C#' });
    }
    if(configuration.startupModel!=='none'){
        add({ id:'user-runtime', name:'Userland runtime', area:'Userland', role:'Provided', category:'Runtime', description:'Ring-3 process/application runtime.', provides:['IUserland'], requires:['IKernel'], sourceHint:'Userland/Provided/Runtime/', origin:'Inu', sdkLanguage:'C#' });
    }
    if(configuration.startupModel==='cli'||configuration.startupModel==='cli-gui'){
        add({ id:'shell', name:'Shell mechanism', area:'Userland', role:'Provided', category:'Shell', description:'Executable-resolving shell mechanism; commands are ordinary OS executables.', provides:['IShell'], requires:['IUserland'], sourceHint:'Userland/Provided/Shell/', origin:'Inu', sdkLanguage:'C#' });
        add({ id:'shell-os', name:`${configuration.name} Shell`, area:'Userland', role:'OS', category:'Shell', description:'Coder-owned Shell.cs.', provides:[], requires:['IShell'], sourceHint:`Userland/${configuration.name}/Shell.cs`, origin:'OS', sdkLanguage:'OS-owned' });
    }
    if(configuration.startupModel==='gui'||configuration.startupModel==='cli-gui'){
        add({ id:'gui', name:'GUI mechanism', area:'Userland', role:'Provided', category:'Gui', description:'Working graphical substrate supplied according to selected hardware.', provides:['IGuiSession'], requires:['IUserland'], sourceHint:'Userland/Provided/Gui/', origin:'Inu', sdkLanguage:'C#' });
        add({ id:'gui-os', name:`${configuration.name} GUI`, area:'Userland', role:'OS', category:'Gui', description:'Coder-owned Gui.cs.', provides:[], requires:['IGuiSession'], sourceHint:`Userland/${configuration.name}/Gui.cs`, origin:'OS', sdkLanguage:'OS-owned' });
    }
    return result;
}
