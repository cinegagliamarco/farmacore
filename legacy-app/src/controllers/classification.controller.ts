import { Controller, Get, Query } from '@nestjs/common';
import { GetClassificationsQueryParamDto } from '../dto/get-classifications-query-param.dto';
import { GetClassificationsUseCase } from '../use-cases/get-classifications.use-case';
import { GetClassificationsGroupedUseCase } from '../use-cases/get-classifications-grouped.use-case';

@Controller('classifications')
export class ClassificationController {
  constructor(
    private readonly getClassificationsUseCase: GetClassificationsUseCase,
    private readonly getClassificationsGroupedUseCase: GetClassificationsGroupedUseCase
  ) {}

  @Get()
  public getClassifications(@Query() qp: GetClassificationsQueryParamDto) {
    return this.getClassificationsUseCase.execute(qp);
  }

  @Get('/grouped')
  public getClassificationsGrouped() {
    return this.getClassificationsGroupedUseCase.execute();
  }
}
