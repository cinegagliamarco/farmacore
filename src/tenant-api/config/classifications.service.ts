import { Injectable } from '@nestjs/common';
import { EntityManager, IsNull } from 'typeorm';
import { ClassificationEntity } from '../../database/entities/tenant/classification.entity';

interface ClassificationRow {
  id: string;
  name: string;
  parentId: string | null;
  visible: boolean;
}

interface ClassificationNode extends ClassificationRow {
  children: ClassificationRow[];
}

@Injectable()
export class ClassificationsService {
  public async list(em: EntityManager): Promise<ClassificationRow[]> {
    const rows = await em.getRepository(ClassificationEntity).find({
      where: { deletedAt: IsNull() },
      order: { name: 'ASC' },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      parentId: row.parentId ?? null,
      visible: row.visible,
    }));
  }

  /** Roots with their direct children — the shape the FE renders as a tree. */
  public async grouped(em: EntityManager): Promise<ClassificationNode[]> {
    const rows = await this.list(em);
    const roots = rows.filter((r) => r.parentId === null);
    return roots.map((root) => ({
      ...root,
      children: rows.filter((r) => r.parentId === root.id),
    }));
  }
}
