import { deflateSync } from "node:zlib";
export function png(width = 1, height = 1, alpha = true) {
  const chunk = (type, data) => {
    const value = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of value) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const length = Buffer.alloc(4),
      sum = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    sum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, value, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = alpha ? 6 : 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.alloc((1 + width * (alpha ? 4 : 3)) * height))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
