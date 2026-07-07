/**
 * Módulos de produto liberados por tenant (coluna `core.tenant.modules`,
 * administrados via PUT /admin/tenants/:slug/modules e aplicados pelo
 * ModulesGuard nas rotas marcadas com @RequireModule).
 */
export enum ModuleCode {
  /** Produtos cruzados — catálogo × preços de concorrentes. */
  CROSSED_PRODUCTS = 'crossed-products',
  ACTIVE_INGREDIENT_ANALYSIS = 'active-ingredient-analysis',
  /** Regras de precificação e sugestão de precificação. */
  PRICING_RULES = 'pricing-rules',
  OFFER_BOOK_RULES = 'offer-book-rules',
  STRATEGIC_PRICING = 'strategic-pricing',
}
