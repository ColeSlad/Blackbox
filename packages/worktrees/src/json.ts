export type JsonValueV1 =
  null | boolean | number | string | readonly JsonValueV1[] | JsonObjectV1;
export interface JsonObjectV1 {
  readonly [key: string]: JsonValueV1;
}
