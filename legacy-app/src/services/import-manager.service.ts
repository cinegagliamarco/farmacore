import { BadRequestException, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { IMPORT_PROCESS_EVENT } from '../common/import.events';
import { ImportProcessRepository } from '../database/repositories/import-process.repository';
import { ImportProcessTypeormEntity } from '../database/entities/import-process.entity';

@Injectable()
export class ImportManagerService implements OnApplicationShutdown {
  constructor(
    private readonly importProcessRepository: ImportProcessRepository,
    private readonly eventEmitter: EventEmitter2
  ) {}

  public async onApplicationShutdown(signal: string): Promise<void> {
    console.log(`Received ${signal}`);
    await this.finishProcess();
  }

  public async startProcess(processName: string, params?: unknown): Promise<void> {
    const runningProcess = await this.importProcessRepository.findRunningProcess();
    if (runningProcess) {
      throw new BadRequestException(`Process ${runningProcess.processName} is already running!`);
    }
    await this.importProcessRepository.startProcess(processName);
    this.eventEmitter.emit(IMPORT_PROCESS_EVENT, { processName, params });
  }

  @OnEvent(IMPORT_PROCESS_EVENT)
  public async runProcess({ processName, params }: { processName: string; params: unknown }): Promise<void> {
    console.log(`Starting process ${processName}`);
    try {
      await this.eventEmitter.emitAsync(processName, params);
    } finally {
      await this.finishProcess(processName);
      console.log(`Finished process ${processName}`);
    }
  }

  public async startMultipleProcesses(listOfProcesses: { processName: string; params?: unknown }[][]): Promise<void> {
    const runningProcess = await this.importProcessRepository.findRunningProcess();
    if (runningProcess) {
      throw new BadRequestException(`Process ${runningProcess.processName} is already running!`);
    }

    const fullProcessName = listOfProcesses.map((p) => p.map((x) => x.processName).join('-')).join('-');
    await this.importProcessRepository.startProcess(fullProcessName);

    try {
      for (const processes of listOfProcesses) {
        await Promise.all(processes.map((p) => this.eventEmitter.emitAsync(IMPORT_PROCESS_EVENT, { processName: p.processName, params: p.params })));
      }
    } finally {
      await this.finishProcess(fullProcessName);
    }
  }

  public async finishProcess(processName?: string): Promise<void> {
    await this.importProcessRepository.finishProcess(processName);
  }

  public async findRunningProcess(): Promise<ImportProcessTypeormEntity | null> {
    return this.importProcessRepository.findRunningProcess();
  }
}
