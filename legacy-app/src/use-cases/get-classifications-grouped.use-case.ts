import { Injectable } from '@nestjs/common';
import { ClassificationRepository } from '../database/repositories/classification.repository';

@Injectable()
export class GetClassificationsGroupedUseCase {
  constructor(private readonly classificationRepository: ClassificationRepository) {}

  public async execute(): Promise<string[]> {
    return this.classificationRepository.getAllClassificationsGroupedByLevel(2);
  }
}
