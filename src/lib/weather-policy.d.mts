export type WeatherRequest = Readonly<{ latitude: number; longitude: number }>;
export type WeatherResponse = Readonly<{ temperature: number; code: number }>;

export declare function normalizeWeatherRequest(value: unknown): WeatherRequest | null;
export declare function normalizeWeatherResponse(value: unknown): WeatherResponse | null;
