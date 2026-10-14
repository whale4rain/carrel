import type { SpikeNote } from './carrel-tool.ts'

export const SAMPLE_NOTES: readonly SpikeNote[] = [
  {
    id: 'note-elasticity',
    title: 'Elasticity, lecture 4',
    text: 'Price elasticity of demand = % change in quantity / % change in price. Insulin is inelastic (about -0.1); restaurant meals are elastic (about -2.3). Mankiw ch. 5, p. 92.',
  },
  {
    id: 'note-surplus',
    title: 'Consumer surplus',
    text: 'Consumer surplus is the area under the demand curve and above the price. A tax shrinks it and creates deadweight loss.',
  },
  {
    id: 'note-comparative',
    title: 'Comparative advantage',
    text: 'Trade pays even when one side is better at everything: each should make what it gives up least to make.',
  },
]
