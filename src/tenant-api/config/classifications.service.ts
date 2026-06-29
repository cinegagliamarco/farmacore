import { Injectable } from '@nestjs/common';
import { EntityManager, IsNull } from 'typeorm';
import { ClassificationEntity } from '../../database/entities/tenant/classification.entity';

interface ClassificationRow {
  id: string;
  name: string;
  parentId: string | null;
  visible: boolean;
}

export interface ClassificationNode extends ClassificationRow {
  children: ClassificationNode[];
}

const MAX_TREE_DEPTH = 3;

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

  /** Nested tree up to three levels — the shape the FE category picker renders. */
  public async grouped(em: EntityManager): Promise<ClassificationNode[]> {
    const rows = await this.list(em);
    const byParent = new Map<string | null, ClassificationRow[]>();
    for (const row of rows) {
      const key = row.parentId;
      const bucket = byParent.get(key) ?? [];
      bucket.push(row);
      byParent.set(key, bucket);
    }

    const attach = (
      row: ClassificationRow,
      depth: number,
    ): ClassificationNode => ({
      ...row,
      children:
        depth >= MAX_TREE_DEPTH
          ? []
          : (byParent.get(row.id) ?? []).map((child) =>
              attach(child, depth + 1),
            ),
    });

    return (byParent.get(null) ?? []).map((root) => attach(root, 1));
  }
}
