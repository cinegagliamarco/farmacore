import { Injectable } from '@nestjs/common';
import { Like, Repository } from 'typeorm';
import { ClassificationTypeormEntity } from '../entities/classification.entity';

@Injectable()
export class ClassificationRepository {
  constructor(private readonly repository: Repository<ClassificationTypeormEntity>) {}

  public async findAll(): Promise<ClassificationTypeormEntity[]> {
    return this.repository.find();
  }

  public async findByName(name: string): Promise<ClassificationTypeormEntity | null> {
    return this.repository.findOne({ where: { name } });
  }

  public async findById(id: number): Promise<ClassificationTypeormEntity | null> {
    return this.repository.findOne({ where: { id } });
  }

  public async findOrCreate(name: string): Promise<ClassificationTypeormEntity> {
    const existing = await this.findByName(name);
    if (existing) return existing;

    const classification = new ClassificationTypeormEntity();
    classification.name = name;

    return this.repository.save(classification);
  }

  public async upsertBatch(names: string[]): Promise<Map<string, ClassificationTypeormEntity>> {
    if (names.length === 0) return new Map();

    const uniqueNames = [...new Set(names.filter((n) => n && n.trim() !== ''))];
    if (uniqueNames.length === 0) return new Map();

    const classifications = uniqueNames.map((name) => ({ name }));

    await this.repository.upsert(classifications, ['name']);

    const savedClassifications = await this.repository.find({
      where: uniqueNames.map((name) => ({ name }))
    });

    const result = new Map<string, ClassificationTypeormEntity>();
    for (const classification of savedClassifications) {
      result.set(classification.name, classification);
    }

    return result;
  }

  public async getClassificationsPaginated(page: number, perPage: number, nameFilter?: string): Promise<[ClassificationTypeormEntity[], number]> {
    const skip = (page - 1) * perPage;

    const where = nameFilter ? { name: Like(`%${nameFilter}%`) } : {};

    return this.repository.findAndCount({
      where,
      skip,
      take: perPage,
      order: { name: 'ASC' }
    });
  }

  public async getAllClassificationsGroupedByLevel(level: number): Promise<string[]> {
    const classifications = await this.repository.find({
      select: ['name'],
      order: { name: 'ASC' }
    });

    const grouped = new Set<string>();

    for (const classification of classifications) {
      const parts = classification.name.split('>').map((part) => part.trim());
      if (parts.length >= level) {
        const groupedName = parts.slice(0, level).join(' > ');
        grouped.add(groupedName);
      }
    }

    return Array.from(grouped).sort((a, b) => a.localeCompare(b));
  }
}
