import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { GENERATE_BASE_PRODUCT_PROPERTIES_USE_CASE } from '../common/import.events';
import { Origin } from '../common/origin.enum';
import { BaseProductTypeormEntity } from '../database/entities/base-product.entity';
import { ProductTypeormEntity } from '../database/entities/product.entity';
import { BaseProductRepository } from '../database/repositories/base-product.repository';
import { ProductRepository } from '../database/repositories/product.repository';

@Injectable()
export class GenerateBaseProductPropertiesUseCase {
  constructor(
    private readonly baseProductRepository: BaseProductRepository,
    private readonly productRepository: ProductRepository
  ) {}

  @OnEvent(GENERATE_BASE_PRODUCT_PROPERTIES_USE_CASE)
  public async execute(): Promise<void> {
    await this.processSuppliers();
    await this.processWeights();
    await this.processName();
    await this.processMeasures();
  }

  private async processSuppliers(): Promise<void> {
    const baseProducts = await this.baseProductRepository.getByEmptySupplier();
    console.log(`Found ${baseProducts.length} without supplier`);

    const workSize = 1000;
    const tasks = [...baseProducts];
    while (tasks.length) {
      console.log(`Remaining ${tasks.length} Base Products (supplier) ${new Date().toISOString()}`);
      const batch = tasks.splice(0, workSize);

      await Promise.all(
        batch.map(async (element) => {
          const newSupplier = await this.findSupplier(element);
          if (!newSupplier) return;

          element.supplier = newSupplier;
          await this.baseProductRepository.save(element);
        })
      );
    }
  }

  private async processWeights(): Promise<void> {
    const baseProducts = await this.baseProductRepository.getByEmptyWeight();
    console.log(`Found ${baseProducts.length} without weight`);

    const workSize = 1000;
    const tasks = [...baseProducts];
    while (tasks.length) {
      console.log(`Remaining ${tasks.length} Base Products (weight) ${new Date().toISOString()}`);
      const batch = tasks.splice(0, workSize);

      await Promise.all(
        batch.map(async (element) => {
          const newWeight = await this.findWeight(element);
          if (!newWeight) return;

          element.weight = newWeight;
          await this.baseProductRepository.save(element);
        })
      );
    }
  }

  private async processName(): Promise<void> {
    const baseProducts = await this.baseProductRepository.getByEmptyName();
    console.log(`Found ${baseProducts.length} without name`);

    const workSize = 1000;
    const tasks = [...baseProducts];
    while (tasks.length) {
      console.log(`Remaining ${tasks.length} Base Products (name) ${new Date().toISOString()}`);
      const batch = tasks.splice(0, workSize);

      await Promise.all(
        batch.map(async (element) => {
          const newName = await this.findName(element);
          if (!newName) return;

          element.name = newName;
          await this.baseProductRepository.save(element);
        })
      );
    }
  }

  private async processMeasures(): Promise<void> {
    const baseProducts = await this.baseProductRepository.getByEmptyMeasures();
    console.log(`Found ${baseProducts.length} without measures`);

    const workSize = 1000;
    const tasks = [...baseProducts];
    while (tasks.length) {
      console.log(`Remaining ${tasks.length} Base Products (measures) ${new Date().toISOString()}`);
      const batch = tasks.splice(0, workSize);

      await Promise.all(
        batch.map(async (element) => {
          const measures = await this.findMeasures(element);
          if (!measures) return;

          element.cubicWeight = measures.cubicWeight;
          element.height = measures.height;
          element.length = measures.length;
          element.width = measures.width;
          if (!element.weight && measures.weight) element.weight = measures.weight;
          await this.baseProductRepository.save(element);
        })
      );
    }
  }

  private async findMeasures(
    element: BaseProductTypeormEntity
  ): Promise<{ cubicWeight: number; height: number; length: number; width: number; weight: number } | undefined> {
    const [drogasil, drogal] = await this.findDrogasilAndDrogal(element);
    const source = drogasil?.cubicWeight ? drogasil : drogal?.cubicWeight ? drogal : undefined;

    if (!source) return undefined;

    return {
      cubicWeight: source.cubicWeight,
      height: source.height,
      length: source.length,
      width: source.width,
      weight: source.weight
    };
  }

  private async findName(element: BaseProductTypeormEntity): Promise<string | undefined> {
    const [drogasil, drogal] = await this.findDrogasilAndDrogal(element);

    return drogasil?.name || drogal?.name;
  }

  private async findSupplier(element: BaseProductTypeormEntity): Promise<string | undefined> {
    const [drogasil, drogal] = await this.findDrogasilAndDrogal(element);

    return drogasil?.supplier || drogal?.supplier || drogasil?.brand || drogal?.brand;
  }

  private async findWeight(element: BaseProductTypeormEntity): Promise<number | undefined> {
    const [drogasil, drogal] = await this.findDrogasilAndDrogal(element);

    return drogasil?.weight || drogal?.weight;
  }

  private findDrogasilAndDrogal(element: BaseProductTypeormEntity): Promise<[ProductTypeormEntity | undefined, ProductTypeormEntity | undefined]> {
    return Promise.all([
      this.productRepository.findByEanAndOrigin(element.ean, Origin.DROGASIL),
      this.productRepository.findByEanAndOrigin(element.ean, Origin.DROGAL)
    ]);
  }
}
