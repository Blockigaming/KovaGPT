export function responseFences(content: string): Generator<{
  info: string;
  start: number;
  body: string;
  end: number;
}>;
