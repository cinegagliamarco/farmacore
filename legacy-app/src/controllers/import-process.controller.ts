import { Controller, Delete, Get } from '@nestjs/common';
import { ImportManagerService } from '../services/import-manager.service';

@Controller('import-process')
export class ImportProcessController {
  constructor(private readonly importManagerService: ImportManagerService) {}

  @Get('/running')
  public async getRunningProcess() {
    return this.importManagerService.findRunningProcess();
  }

  @Delete('/running')
  public async stopRunningProcess() {
    return this.importManagerService.finishProcess();
  }
}
