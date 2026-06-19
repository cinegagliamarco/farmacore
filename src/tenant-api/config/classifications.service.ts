import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

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
    return em.query(
      `SELECT id, name, parent_id AS "parentId", visible
         FROM classification
        WHERE deleted_at IS NULL
        ORDER BY name ASC`,
    );
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
