import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { CreatePriceRoundingRuleBodyDto, UpdatePriceRoundingRuleBodyDto } from '../dto/price-rounding-rule-body.dto';
import { GetPriceRoundingRulesQueryParamDto } from '../dto/price-rounding-rule-query-param.dto';
import { CreatePriceRoundingRuleUseCase } from '../use-cases/create-price-rounding-rule.use-case';
import { GetPriceRoundingRuleUseCase } from '../use-cases/get-price-rounding-rule.use-case';
import { ListPriceRoundingRulesUseCase } from '../use-cases/list-price-rounding-rules.use-case';
import { UpdatePriceRoundingRuleUseCase } from '../use-cases/update-price-rounding-rule.use-case';
import { DeletePriceRoundingRuleUseCase } from '../use-cases/delete-price-rounding-rule.use-case';
import { PriceRoundingRuleTypeormEntity } from '../database/entities/price-rounding-rule.entity';

@Controller('configurations')
export class ConfigurationsController {
  constructor(
    private readonly createPriceRoundingRuleUseCase: CreatePriceRoundingRuleUseCase,
    private readonly getPriceRoundingRuleUseCase: GetPriceRoundingRuleUseCase,
    private readonly listPriceRoundingRulesUseCase: ListPriceRoundingRulesUseCase,
    private readonly updatePriceRoundingRuleUseCase: UpdatePriceRoundingRuleUseCase,
    private readonly deletePriceRoundingRuleUseCase: DeletePriceRoundingRuleUseCase
  ) {}

  @Get('price-rounding')
  public list(@Query() query: GetPriceRoundingRulesQueryParamDto): Promise<{ rows: PriceRoundingRuleTypeormEntity[]; count: number }> {
    return this.listPriceRoundingRulesUseCase.execute(query);
  }

  @Post('price-rounding')
  public create(@Body() dto: CreatePriceRoundingRuleBodyDto): Promise<PriceRoundingRuleTypeormEntity> {
    return this.createPriceRoundingRuleUseCase.execute(dto);
  }

  @Get('price-rounding/:id')
  public getById(@Param('id', ParseIntPipe) id: number): Promise<PriceRoundingRuleTypeormEntity> {
    return this.getPriceRoundingRuleUseCase.execute(id);
  }

  @Patch('price-rounding/:id')
  public update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePriceRoundingRuleBodyDto): Promise<PriceRoundingRuleTypeormEntity> {
    return this.updatePriceRoundingRuleUseCase.execute(id, dto);
  }

  @Delete('price-rounding/:id')
  public delete(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.deletePriceRoundingRuleUseCase.execute(id);
  }
}
