import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CronTime, validateCronExpression } from 'cron';
import { EntityManager } from 'typeorm';
import {
  PricingScheduleEntity,
  ScheduleItem,
} from '../../database/entities/tenant/pricing-schedule.entity';
import { CreateScheduleDto } from './dto/schedule.dto';

export interface ScheduleView {
  id: string;
  runAt: string;
  status: string;
  applyRunId: string | null;
  itemCount: number;
  cronExpr: string | null;
  recalc: boolean;
  createdAt: string;
}

export interface DueSchedule {
  id: string;
  runAt: Date;
  requestedBy: string | null;
  items: ScheduleItem[];
  cronExpr: string | null;
  recalc: boolean;
}

interface ScheduleRow {
  id: string;
  runAt: Date;
  status: string;
  applyRunId: string | null;
  items: ScheduleItem[];
  cronExpr: string | null;
  recalc: boolean;
  createdAt: Date;
}

const toView = (r: ScheduleRow): ScheduleView => ({
  id: r.id,
  runAt: new Date(r.runAt).toISOString(),
  status: r.status,
  applyRunId: r.applyRunId,
  itemCount: Array.isArray(r.items) ? r.items.length : 0,
  cronExpr: r.cronExpr,
  recalc: r.recalc,
  createdAt: new Date(r.createdAt).toISOString(),
});

/** Próxima ocorrência (UTC) de um cron, como Date. */
const nextOccurrence = (cronExpr: string): Date =>
  new CronTime(cronExpr, 'UTC').sendAt().toJSDate();

/**
 * CRUD dos agendamentos de aplicação (one-shot). `claimNext`/`markFired` são o
 * caminho do cron — separados do apply para o service não depender dele.
 */
@Injectable()
export class PricingScheduleService {
  public async create(
    em: EntityManager,
    requestedBy: string,
    dto: CreateScheduleDto,
  ): Promise<ScheduleView> {
    if (dto.cronExpr && !validateCronExpression(dto.cronExpr).valid) {
      throw new BadRequestException(`cron inválido: ${dto.cronExpr}`);
    }
    const [row]: ScheduleRow[] = await em.query(
      `INSERT INTO pricing_schedule
         (run_at, requested_by, items, cron_expr, recalc)
       VALUES ($1, $2, $3::jsonb, $4, $5)
       RETURNING id, run_at AS "runAt", status, apply_run_id AS "applyRunId",
                 items, cron_expr AS "cronExpr", recalc, created_at AS "createdAt"`,
      [
        dto.runAt,
        requestedBy,
        JSON.stringify(dto.items),
        dto.cronExpr ?? null,
        dto.recalc ?? false,
      ],
    );
    return toView(row);
  }

  public async list(em: EntityManager): Promise<ScheduleView[]> {
    const rows: ScheduleRow[] = await em.query(
      `SELECT id, run_at AS "runAt", status, apply_run_id AS "applyRunId",
              items, cron_expr AS "cronExpr", recalc, created_at AS "createdAt"
         FROM pricing_schedule
        WHERE deleted_at IS NULL
        ORDER BY run_at DESC`,
    );
    return rows.map(toView);
  }

  public async get(em: EntityManager, id: string): Promise<ScheduleView> {
    const rows: ScheduleRow[] = await em.query(
      `SELECT id, run_at AS "runAt", status, apply_run_id AS "applyRunId",
              items, cron_expr AS "cronExpr", recalc, created_at AS "createdAt"
         FROM pricing_schedule WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [id],
    );
    if (!rows.length) throw new NotFoundException(`schedule ${id} not found`);
    return toView(rows[0]);
  }

  public async cancel(
    em: EntityManager,
    id: string,
  ): Promise<{ id: string; cancelled: boolean }> {
    // Guard atômico de status: se o cron já travou + disparou (FOR UPDATE SKIP
    // LOCKED), este UPDATE espera o lock e então afeta 0 linhas (status='fired')
    // — não sobrescreve um agendamento já disparado para 'cancelled'. Usa o
    // repositório (`.affected`) em vez de UPDATE..RETURNING (que com em.query
    // volta [rows, count] e confundiria a contagem).
    const res = await em
      .getRepository(PricingScheduleEntity)
      .update({ id, status: 'pending' }, { status: 'cancelled' });
    if (res.affected) return { id, cancelled: true };
    const current = await this.get(em, id); // 404 se não existir
    throw new ConflictException(
      `schedule ${id} is ${current.status} and cannot be cancelled`,
    );
  }

  /** Next due-and-pending schedule, locked (SKIP LOCKED) for this transaction
   *  — only one API replica processes each one. The cron runs one transaction
   *  per schedule, so it claims one at a time. */
  public async claimNext(em: EntityManager): Promise<DueSchedule | null> {
    const rows: DueSchedule[] = await em.query(
      `SELECT id, run_at AS "runAt", requested_by AS "requestedBy", items,
              cron_expr AS "cronExpr", recalc
         FROM pricing_schedule
        WHERE status = 'pending' AND deleted_at IS NULL AND run_at <= now()
        ORDER BY run_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED`,
    );
    return rows[0] ?? null;
  }

  public async markFired(
    em: EntityManager,
    id: string,
    applyRunId: string | null,
  ): Promise<void> {
    await em.query(
      `UPDATE pricing_schedule
          SET status='fired', apply_run_id=$2, fired_at=now(), updated_at=now()
        WHERE id=$1`,
      [id, applyRunId],
    );
  }

  /** A schedule whose apply threw (e.g. circuit breaker) — parks it as
   *  'failed' so the cron doesn't retry it forever. Guarded on the claimed
   *  (status, run_at): the failing claim's tx already rolled back, so
   *  another replica may have re-claimed and FIRED the schedule in the
   *  gap — an unguarded park would kill a schedule that actually applied. */
  public async markFailed(
    em: EntityManager,
    id: string,
    claimedRunAt: Date,
  ): Promise<void> {
    await em.query(
      `UPDATE pricing_schedule SET status='failed', updated_at=now()
        WHERE id=$1 AND status='pending' AND run_at=$2`,
      [id, claimedRunAt],
    );
  }

  /**
   * Recorrente: registra o último disparo e re-arma para a próxima ocorrência
   * do cron (volta a 'pending'). Mantém histórico em `apply_run_id`/`fired_at`
   * do disparo mais recente.
   */
  public async reArm(
    em: EntityManager,
    id: string,
    cronExpr: string,
    applyRunId: string | null,
  ): Promise<void> {
    await em.query(
      `UPDATE pricing_schedule
          SET run_at=$2, apply_run_id=$3, fired_at=now(), updated_at=now()
        WHERE id=$1`,
      [id, nextOccurrence(cronExpr), applyRunId],
    );
  }
}
