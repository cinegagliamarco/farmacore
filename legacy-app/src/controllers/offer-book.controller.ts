import { Controller, Get, Post, Query } from '@nestjs/common';
import { SYNCHRONIZE_OFFER_BOOKS_INFO_USE_CASE } from '../common/import.events';
import { ImportManagerService } from '../services/import-manager.service';
import { GetOfferBookInfoQueryParamDto } from '../dto/get-offer-book-info-query-param.dto';
import { GetOfferBooksInfoUseCase } from '../use-cases/get-offer-books-info.use-case';

@Controller('offer-books')
export class OfferBookController {
  constructor(
    private readonly getOfferBooksInfoUseCase: GetOfferBooksInfoUseCase,
    private readonly importManagerService: ImportManagerService
  ) {}

  @Get('/info')
  public getOfferBooksInfo(@Query() query: GetOfferBookInfoQueryParamDto) {
    return this.getOfferBooksInfoUseCase.execute(query);
  }

  @Post('/info/synchronize')
  public synchronizeOfferBooksInfo() {
    return this.importManagerService.startProcess(SYNCHRONIZE_OFFER_BOOKS_INFO_USE_CASE);
  }
}
