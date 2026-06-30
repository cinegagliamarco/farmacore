import { Repository } from 'typeorm';
import { PrecoEmbalagemUnidadeNegocioEntity } from '../../entities/a7pharma/preco-embalagem-unidade-negocio.entity';

/**
 * Read-only repository over A7Pharma's per-store sell-price overrides.
 * Plain class, instantiated per pipeline-step invocation.
 */
export class PrecoEmbalagemUnidadeNegocioRepository {
  constructor(
    private readonly repository: Repository<PrecoEmbalagemUnidadeNegocioEntity>,
  ) {}

  /** Per-store sell prices for a slice of embalagens in one store. */
  public findByEmbalagemIdsAndUnidade(
    embalagemIds: number[],
    unidadeNegocioId: number,
  ): Promise<PrecoEmbalagemUnidadeNegocioEntity[]> {
    if (embalagemIds.length === 0) return Promise.resolve([]);
    return this.repository
      .createQueryBuilder('p')
      .where('p.embalagemid IN (:...embalagemIds)', { embalagemIds })
      .andWhere('p.unidadenegocioid = :unidadeNegocioId', { unidadeNegocioId })
      .getMany();
  }
}
