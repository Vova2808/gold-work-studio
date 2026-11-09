/** A narrated relationship, staged independently of illustrative photography. */
export interface DocumentaryExplanation {
  kind: 'flow' | 'branch' | 'merge' | 'exchange' | 'cycle' | 'contrast';
  nodes: Array<{
    id: string;
    label: string;
    symbol: 'person' | 'team' | 'machine' | 'motorcycle' | 'signal' | 'energy' | 'document' | 'place' | 'time' | 'generic';
    /** Explicit concrete subject, not inferred from its label. Optional for legacy
     * and abstract nodes; a declared type must match the rendered symbol. */
    objectType?: 'motorcycle';
  }>;
  emphasis?: string;
  signal?: 'steady' | 'interrupted';
  /** Continuous choreography across a complete spoken thought, without retiming audio. */
  sequence?: {id:string;offsetFrames:number;durationInFrames:number};
}
