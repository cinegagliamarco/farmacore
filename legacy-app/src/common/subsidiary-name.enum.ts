export enum SubsidiaryName {
  LOJA_1 = 'LOJA 1',
  LOJA_2 = 'LOJA 2',
  LOJA_3 = 'LOJA 3'
}

export const SubsidiaryMaping: Map<number, { name: SubsidiaryName; externalId: number }> = new Map([
  [12023529, { name: SubsidiaryName.LOJA_1, externalId: 12023529 }],
  [1, { name: SubsidiaryName.LOJA_2, externalId: 1 }],
  [12025902, { name: SubsidiaryName.LOJA_3, externalId: 12025902 }]
]);
