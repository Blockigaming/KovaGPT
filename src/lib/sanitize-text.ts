export function replaceControlCharacters(value: string, replacement = " "): string {
  let output = "";
  for (const char of value) {
    const code = char.charCodeAt(0);
    output += code <= 31 || code === 127 ? replacement : char;
  }
  return output;
}

export function removeNulCharacters(value: string): string {
  return value.split("\0").join("");
}
