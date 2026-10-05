import * as fs from 'fs/promises';
import * as path from 'path';
import {
    InuDiskImageDescriptor,
    InuDiskImageInspection,
    InuDiskPartition,
    InuDiskVolume,
    InuDiskEntry,
    InuDiskReadResult
} from '../common/inu-protocol';

/** Disk/Image Explorer operations, isolated from project lifecycle orchestration. */
export class InuDiskImageService {
    constructor(
        protected readonly sdkRoot: string,
        protected readonly isOperatingSystemPath: (projectRoot: string) => boolean
    ) {}

    async listDiskImages(projectPath: string): Promise<InuDiskImageDescriptor[]> {
        const projectRoot = path.resolve(projectPath);
        if (!this.isOperatingSystemPath(projectRoot)) return [];
        const result: InuDiskImageDescriptor[] = [];
        const seen = new Set<string>();
        const extensions = new Set(['.img', '.raw', '.iso', '.vhd', '.vhdx', '.bin']);
        const add = async (filePath: string, origin: 'os' | 'sdk'): Promise<void> => {
            const resolved = path.resolve(filePath);
            const ext = path.extname(resolved).toLowerCase();
            if (!extensions.has(ext)) return;
            const key = resolved.toLowerCase();
            if (seen.has(key)) return;
            try {
                const stat = await fs.stat(resolved); if (!stat.isFile()) return;
                const baseName = path.basename(resolved).toLowerCase();
                // QEMU debugger rendezvous/trace payloads are binary files, not disk images.
                // Never let them swamp the Image / Disk Explorer simply because they use .bin.
                if (ext === '.bin' && (baseName === 'debugcon.bin' || baseName.startsWith('debugcon-') || baseName.endsWith('.debug.bin'))) return;
                let formatHint = ext === '.iso' ? 'ISO image' : ext === '.vhd' ? 'VHD' : ext === '.vhdx' ? 'VHDX' : 'Raw disk image';
                let diskSignatureDetected = false;
                const handle = await fs.open(resolved, 'r');
                try {
                    const probe = Buffer.alloc(Math.min(0x9000, stat.size));
                    await handle.read(probe, 0, probe.length, 0);
                    if (probe.length >= 520 && probe.subarray(512, 520).toString('ascii') === 'EFI PART') { formatHint = 'GPT disk image'; diskSignatureDetected = true; }
                    else if (probe.length >= 512 && probe[510] === 0x55 && probe[511] === 0xaa) { formatHint = 'MBR/raw disk image'; diskSignatureDetected = true; }
                    if (probe.length >= 90 && probe.subarray(82, 90).toString('ascii').startsWith('FAT32')) { formatHint = 'FAT32 disk image'; diskSignatureDetected = true; }
                    if (probe.length >= 0x8006 && probe.subarray(0x8001, 0x8006).toString('ascii') === 'CD001') { formatHint = 'ISO 9660 image'; diskSignatureDetected = true; }
                    if (probe.length >= 8 && probe.subarray(0, 8).toString('ascii') === 'vhdxfile') { formatHint = 'VHDX'; diskSignatureDetected = true; }
                } finally { await handle.close(); }
                // A generic .bin must either look like a disk or be large enough to plausibly be one.
                // This removes tiny debugger/telemetry payloads while retaining legitimate raw .bin images.
                if (ext === '.bin' && !diskSignatureDetected && stat.size < 1024 * 1024) return;
                result.push({ id: `${origin}:${key}`, name: path.basename(resolved), path: resolved, origin, sizeBytes: stat.size, modifiedUtc: stat.mtime.toISOString(), formatHint });
                seen.add(key);
            } catch { }
        };
        const scan = async (directory: string, origin: 'os' | 'sdk', depth: number): Promise<void> => {
            if (depth < 0 || result.length >= 250) return;
            const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [] as import('fs').Dirent[]);
            for (const entry of entries) {
                if (result.length >= 250) break;
                const full = path.join(directory, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name === 'node_modules' || entry.name === '.git') continue;
                    await scan(full, origin, depth - 1);
                } else if (entry.isFile()) await add(full, origin);
            }
        };
        await scan(projectRoot, 'os', 4);
        await scan(path.join(this.sdkRoot, 'Artifacts'), 'sdk', 5);
        return result.sort((a,b) => {
            const origin = Number(b.origin === 'os') - Number(a.origin === 'os');
            if (origin) return origin;
            const confidence = (value: InuDiskImageDescriptor): number => /GPT|MBR|FAT32|ISO 9660|VHDX/.test(value.formatHint) ? 2 : /\.(img|raw|iso|vhd|vhdx)$/i.test(value.name) ? 1 : 0;
            const confidenceOrder = confidence(b) - confidence(a);
            if (confidenceOrder) return confidenceOrder;
            const modifiedOrder = Date.parse(b.modifiedUtc) - Date.parse(a.modifiedUtc);
            if (modifiedOrder) return modifiedOrder;
            return b.sizeBytes - a.sizeBytes || a.name.localeCompare(b.name);
        });
    }

    protected diskImageAllowed(projectRoot: string, imagePath: string): boolean {
        const resolved = path.resolve(imagePath);
        return [projectRoot, path.resolve(this.sdkRoot, 'Artifacts')].some(root => {
            const rel = path.relative(root, resolved);
            return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
        });
    }

    protected guidFromDiskBytes(bytes: Buffer): string {
        if (bytes.length < 16) return '';
        const d1 = bytes.readUInt32LE(0).toString(16).padStart(8,'0');
        const d2 = bytes.readUInt16LE(4).toString(16).padStart(4,'0');
        const d3 = bytes.readUInt16LE(6).toString(16).padStart(4,'0');
        const d4 = bytes.subarray(8,10).toString('hex');
        const d5 = bytes.subarray(10,16).toString('hex');
        return `${d1}-${d2}-${d3}-${d4}-${d5}`.toUpperCase();
    }

    protected fatShortName(entry: Buffer): string {
        const base = entry.subarray(0,8).toString('ascii').trimEnd();
        const ext = entry.subarray(8,11).toString('ascii').trimEnd();
        return ext ? `${base}.${ext}` : base;
    }

    protected fatLongNamePart(entry: Buffer): string {
        const units: number[] = [];
        for (const [start,count] of [[1,5],[14,6],[28,2]] as Array<[number,number]>) {
            for (let i=0;i<count;i++) { const value=entry.readUInt16LE(start+i*2); if (value===0 || value===0xffff) return String.fromCharCode(...units); units.push(value); }
        }
        return String.fromCharCode(...units);
    }

    protected async parseFat32(handle: import('fs/promises').FileHandle, partition: InuDiskPartition, entries: InuDiskEntry[]): Promise<InuDiskVolume | undefined> {
        const boot = Buffer.alloc(512); const read = await handle.read(boot,0,512,partition.offsetBytes); if (read.bytesRead < 90) return undefined;
        const bps=boot.readUInt16LE(11), spc=boot[13], reserved=boot.readUInt16LE(14), fats=boot[16], total=boot.readUInt32LE(32) || boot.readUInt16LE(19), spf=boot.readUInt32LE(36), rootCluster=boot.readUInt32LE(44);
        const signature=boot.subarray(82,90).toString('ascii');
        if (!bps || !spc || !reserved || !fats || !spf || !rootCluster || !signature.startsWith('FAT32')) return undefined;
        const label=boot.subarray(71,82).toString('ascii').trim();
        const fatOffset=partition.offsetBytes + reserved*bps;
        const dataOffset=partition.offsetBytes + (reserved + fats*spf)*bps;
        const fatBytes=spf*bps;
        if (fatBytes > 64*1024*1024) return { partitionIndex:partition.index,fileSystem:'FAT32',label,bytesPerSector:bps,sectorsPerCluster:spc,totalSectors:total,fatCount:fats,sectorsPerFat:spf,rootCluster };
        const fat=Buffer.alloc(fatBytes); await handle.read(fat,0,fat.length,fatOffset);
        const clusterBytes=bps*spc;
        const nextCluster=(cluster:number):number => { const o=cluster*4; return o+4<=fat.length ? fat.readUInt32LE(o)&0x0fffffff : 0x0fffffff; };
        const readChain=async(first:number,maxBytes=16*1024*1024):Promise<Buffer>=>{
            const chunks: Buffer[]=[]; let cluster=first, count=0,totalBytes=0; const visited=new Set<number>();
            while(cluster>=2 && cluster<0x0ffffff8 && !visited.has(cluster) && count<65536 && totalBytes<maxBytes){ visited.add(cluster); const b=Buffer.alloc(clusterBytes); const pos=dataOffset+(cluster-2)*clusterBytes; const r=await handle.read(b,0,b.length,pos); chunks.push(r.bytesRead===b.length?b:b.subarray(0,r.bytesRead)); totalBytes+=r.bytesRead; if(r.bytesRead<b.length)break; cluster=nextCluster(cluster); count++; }
            return Buffer.concat(chunks);
        };
        const walk=async(first:number,parentPath:string,depth:number):Promise<void>=>{
            if(depth>32 || entries.length>=5000) return;
            const data=await readChain(first,8*1024*1024); let longParts:string[]=[];
            for(let o=0;o+32<=data.length;o+=32){ const e=data.subarray(o,o+32); if(e[0]===0)break; if(e[0]===0xe5){longParts=[];continue;} const attr=e[11];
                if(attr===0x0f){ longParts.unshift(this.fatLongNamePart(e)); continue; }
                if(attr & 0x08){ longParts=[]; continue; }
                const short=this.fatShortName(e); const name=(longParts.join('')||short).trim(); longParts=[]; if(!name || name==='.' || name==='..')continue;
                const high=e.readUInt16LE(20), low=e.readUInt16LE(26), cluster=(high<<16)|low, size=e.readUInt32LE(28), directory=!!(attr&0x10); const p=parentPath==='/'?`/${name}`:`${parentPath}/${name}`;
                const attrs:string[]=[]; if(attr&1)attrs.push('read-only'); if(attr&2)attrs.push('hidden'); if(attr&4)attrs.push('system'); if(attr&0x10)attrs.push('directory'); if(attr&0x20)attrs.push('archive');
                entries.push({path:p,parentPath,name,directory,sizeBytes:size,firstCluster:cluster,partitionIndex:partition.index,attributes:attrs});
                if(directory && cluster>=2) await walk(cluster,p,depth+1); if(entries.length>=5000)break;
            }
        };
        await walk(rootCluster,'/',0);
        let freeClusters=0; for(let o=8;o+4<=fat.length;o+=4)if((fat.readUInt32LE(o)&0x0fffffff)===0)freeClusters++;
        return { partitionIndex:partition.index,fileSystem:'FAT32',label,bytesPerSector:bps,sectorsPerCluster:spc,totalSectors:total,fatCount:fats,sectorsPerFat:spf,rootCluster,freeClusters };
    }

    async inspectDiskImage(projectPath: string, imagePath: string): Promise<InuDiskImageInspection> {
        const projectRoot=path.resolve(projectPath), resolved=path.resolve(imagePath);
        const failure=(error:string):InuDiskImageInspection=>({success:false,scheme:'unknown',sectorSize:512,protectiveMbr:false,partitions:[],volumes:[],entries:[],entryCount:0,truncated:false,error});
        if(!this.isOperatingSystemPath(projectRoot)||!this.diskImageAllowed(projectRoot,resolved))return failure('Disk inspection is limited to the open Inu OS and bundled SDK artifacts.');
        const image=(await this.listDiskImages(projectRoot)).find(i=>path.resolve(i.path).toLowerCase()===resolved.toLowerCase()); if(!image)return failure('The selected disk image is no longer available.');
        const handle=await fs.open(resolved,'r');
        try{
            const stat=await handle.stat(); const sectorSize=512; const first=Buffer.alloc(512); await handle.read(first,0,512,0); const mbrSig=first[510]===0x55&&first[511]===0xaa;
            const gpt=Buffer.alloc(512); if(stat.size>=1024)await handle.read(gpt,0,512,512); const isGpt=gpt.subarray(0,8).toString('ascii')==='EFI PART';
            const partitions:InuDiskPartition[]=[], volumes:InuDiskVolume[]=[], entries:InuDiskEntry[]=[]; let protectiveMbr=false, diskGuid:string|undefined; let scheme:'gpt'|'mbr'|'none'|'unknown'=mbrSig?'mbr':'none';
            if(isGpt){ scheme='gpt'; diskGuid=this.guidFromDiskBytes(gpt.subarray(56,72)); const entriesLba=Number(gpt.readBigUInt64LE(72)), count=Math.min(gpt.readUInt32LE(80),1024), entrySize=gpt.readUInt32LE(84);
                if(entrySize>=128&&entrySize<=1024&&count>0){ const tableBytes=Math.min(count*entrySize,4*1024*1024); const table=Buffer.alloc(tableBytes); await handle.read(table,0,table.length,entriesLba*sectorSize);
                    for(let i=0;i<count;i++){ const o=i*entrySize;if(o+128>table.length)break; const e=table.subarray(o,o+entrySize); if(e.subarray(0,16).every(v=>v===0))continue; const firstLba=e.readBigUInt64LE(32),lastLba=e.readBigUInt64LE(40); if(lastLba<firstLba)continue; const name=e.subarray(56,Math.min(128,e.length)).toString('utf16le').replace(/\0.*$/,''); const typeGuid=this.guidFromDiskBytes(e.subarray(0,16)), uniqueGuid=this.guidFromDiskBytes(e.subarray(16,32)); const size=Number(lastLba-firstLba+1n)*sectorSize;
                        partitions.push({index:partitions.length+1,scheme:'gpt',name:name||`Partition ${partitions.length+1}`,type:typeGuid==='C12A7328-F81F-11D2-BA4B-00A0C93EC93B'?'EFI System Partition':'GPT partition',typeGuid,uniqueGuid,firstLba:firstLba.toString(),lastLba:lastLba.toString(),offsetBytes:Number(firstLba)*sectorSize,sizeBytes:size,bootable:typeGuid==='C12A7328-F81F-11D2-BA4B-00A0C93EC93B'}); }
                }
                if(mbrSig)for(let i=0;i<4;i++)if(first[446+i*16+4]===0xee)protectiveMbr=true;
            } else if(mbrSig){ for(let i=0;i<4;i++){const o=446+i*16,type=first[o+4]; if(type===0)continue; const firstLba=first.readUInt32LE(o+8),sectors=first.readUInt32LE(o+12); partitions.push({index:partitions.length+1,scheme:'mbr',name:`Partition ${i+1}`,type:`MBR type 0x${type.toString(16).padStart(2,'0')}`,firstLba:String(firstLba),lastLba:String(firstLba+Math.max(0,sectors-1)),offsetBytes:firstLba*sectorSize,sizeBytes:sectors*sectorSize,bootable:first[o]===0x80}); } }
            for(const partition of partitions){ try{ const volume=await this.parseFat32(handle,partition,entries); if(volume)volumes.push(volume); }catch{} }
            if(partitions.length===0 && stat.size>=512){ const whole:InuDiskPartition={index:0,scheme:'mbr',name:'Whole image',type:'Unpartitioned',firstLba:'0',lastLba:String(Math.floor(stat.size/512)-1),offsetBytes:0,sizeBytes:stat.size,bootable:false}; try{const volume=await this.parseFat32(handle,whole,entries);if(volume)volumes.push(volume);}catch{} }
            return {success:true,image,scheme,sectorSize,protectiveMbr,diskGuid,partitions,volumes,entries,entryCount:entries.length,truncated:entries.length>=5000,message:volumes.length?`Detected ${volumes.map(v=>v.fileSystem).join(', ')} filesystem metadata.`:'Partition metadata is available; no supported FAT32 filesystem was detected.'};
        }catch(error){return failure(error instanceof Error?error.message:String(error));}finally{await handle.close();}
    }

    async readDiskImage(projectPath:string,imagePath:string,offset:number,length:number):Promise<InuDiskReadResult>{
        const projectRoot=path.resolve(projectPath),resolved=path.resolve(imagePath); const bounded=Math.max(1,Math.min(4096,Math.floor(length||512))),start=Math.max(0,Math.floor(offset||0));
        if(!this.isOperatingSystemPath(projectRoot)||!this.diskImageAllowed(projectRoot,resolved))return {success:false,imagePath:resolved,source:'disk',offset:start,length:0,bytes:[],error:'Disk read is outside the allowed Inu project/artifact roots.'};
        try{const handle=await fs.open(resolved,'r');try{const stat=await handle.stat();if(start>=stat.size)return {success:false,imagePath:resolved,source:'disk',offset:start,length:0,totalLength:stat.size,bytes:[],error:'Offset is beyond the end of the image.'};const b=Buffer.alloc(Math.min(bounded,stat.size-start));const r=await handle.read(b,0,b.length,start);return {success:true,imagePath:resolved,source:'disk',offset:start,length:r.bytesRead,totalLength:stat.size,bytes:Array.from(b.subarray(0,r.bytesRead))};}finally{await handle.close();}}catch(error){return {success:false,imagePath:resolved,source:'disk',offset:start,length:0,bytes:[],error:error instanceof Error?error.message:String(error)};}
    }

    async readDiskImageEntry(projectPath:string,imagePath:string,entryPath:string,offset:number,length:number):Promise<InuDiskReadResult>{
        const inspection=await this.inspectDiskImage(projectPath,imagePath); const resolved=path.resolve(imagePath), start=Math.max(0,Math.floor(offset||0)), bounded=Math.max(1,Math.min(4096,Math.floor(length||512)));
        if(!inspection.success)return {success:false,imagePath:resolved,source:'file',entryPath,offset:start,length:0,bytes:[],error:inspection.error}; const entry=inspection.entries.find(e=>e.path===entryPath&&!e.directory); if(!entry)return {success:false,imagePath:resolved,source:'file',entryPath,offset:start,length:0,bytes:[],error:'The selected FAT32 file was not found.'}; if(start>=entry.sizeBytes)return {success:false,imagePath:resolved,source:'file',entryPath,offset:start,length:0,totalLength:entry.sizeBytes,bytes:[],error:'Offset is beyond the end of the file.'};
        const partition=inspection.partitions.find(p=>p.index===entry.partitionIndex) ?? (entry.partitionIndex===0?{offsetBytes:0} as InuDiskPartition:undefined); const volume=inspection.volumes.find(v=>v.partitionIndex===entry.partitionIndex); if(!partition||!volume?.bytesPerSector||!volume.sectorsPerCluster||!volume.sectorsPerFat||volume.rootCluster===undefined)return {success:false,imagePath:resolved,source:'file',entryPath,offset:start,length:0,bytes:[],error:'FAT32 volume geometry is unavailable.'};
        try{const handle=await fs.open(resolved,'r');try{const bps=volume.bytesPerSector,spc=volume.sectorsPerCluster,reservedBuf=Buffer.alloc(64);await handle.read(reservedBuf,0,64,partition.offsetBytes);const reserved=reservedBuf.readUInt16LE(14),fats=reservedBuf[16],fatOffset=partition.offsetBytes+reserved*bps,dataOffset=partition.offsetBytes+(reserved+fats*volume.sectorsPerFat)*bps,fat=Buffer.alloc(volume.sectorsPerFat*bps);await handle.read(fat,0,fat.length,fatOffset);const clusterBytes=bps*spc,next=(c:number)=>{const o=c*4;return o+4<=fat.length?fat.readUInt32LE(o)&0x0fffffff:0x0fffffff;};let cluster=entry.firstCluster,skip=Math.floor(start/clusterBytes),within=start%clusterBytes;const seen=new Set<number>();while(skip-->0&&cluster>=2&&cluster<0x0ffffff8&&!seen.has(cluster)){seen.add(cluster);cluster=next(cluster);}const wanted=Math.min(bounded,entry.sizeBytes-start),out=Buffer.alloc(wanted);let written=0;seen.clear();while(written<wanted&&cluster>=2&&cluster<0x0ffffff8&&!seen.has(cluster)){seen.add(cluster);const take=Math.min(wanted-written,clusterBytes-within);const pos=dataOffset+(cluster-2)*clusterBytes+within;const r=await handle.read(out,written,take,pos);written+=r.bytesRead;if(r.bytesRead<take)break;cluster=next(cluster);within=0;}return {success:true,imagePath:resolved,source:'file',entryPath,offset:start,length:written,totalLength:entry.sizeBytes,bytes:Array.from(out.subarray(0,written))};}finally{await handle.close();}}catch(error){return {success:false,imagePath:resolved,source:'file',entryPath,offset:start,length:0,totalLength:entry.sizeBytes,bytes:[],error:error instanceof Error?error.message:String(error)};}
    }

}
