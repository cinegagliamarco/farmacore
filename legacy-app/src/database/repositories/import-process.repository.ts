import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { ImportProcessTypeormEntity } from '../entities/import-process.entity';

@Injectable()
export class ImportProcessRepository {
  constructor(private readonly repository: Repository<ImportProcessTypeormEntity>) {}

  public async findRunningProcess(processName?: string): Promise<ImportProcessTypeormEntity | null> {
    return this.repository.findOne({ where: { finished: false, processName } });
  }

  public async startProcess(processName: string): Promise<void> {
    const process = new ImportProcessTypeormEntity();
    process.processName = processName;
    await this.repository.save(process);
  }

  public async finishProcess(processName: string): Promise<void> {
    const process = await this.findRunningProcess(processName);
    if (!process) return;

    process.finished = true;

    await this.repository.save(process);
  }
}
