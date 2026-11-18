/** The one flat input record every controller produces (ADR 002). */
export interface TruckInput {
  gas?: boolean;
  left: boolean;
  right: boolean;
  brake: boolean;
  nitro: boolean;
  item: boolean;
  itemAlt: boolean;
}

export const NEUTRAL_INPUT: TruckInput = {
  gas: false,
  left: false,
  right: false,
  brake: false,
  nitro: false,
  item: false,
  itemAlt: false,
};
