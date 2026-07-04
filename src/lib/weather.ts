export interface CurrentWeather {
  tempF: number;
  tempC: number;
  condition: string;
  icon: string;
  humidity: number;
  windMph: number;
}

export interface DailyForecast {
  date: string; // ISO date
  highF: number;
  lowF: number;
  highC: number;
  lowC: number;
  condition: string;
  icon: string;
}

export interface WeatherResult {
  current: CurrentWeather;
  daily: DailyForecast[]; // next 5 days, including today
}

/**
 * Thin wrapper around OpenWeatherMap's "One Call" API. Swappable: implement
 * the same WeatherResult shape for WeatherAPI.com and switch on
 * WEATHER_PROVIDER without touching callers.
 */
export async function getWeather(lat: number, lon: number): Promise<WeatherResult> {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) throw new Error("OPENWEATHER_API_KEY is not configured");

  const url = new URL("https://api.openweathermap.org/data/3.0/onecall");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("units", "imperial");
  url.searchParams.set("exclude", "minutely,hourly,alerts");
  url.searchParams.set("appid", apiKey);

  const res = await fetch(url.toString(), { next: { revalidate: 900 } });
  if (!res.ok) {
    throw new Error(`Weather provider error: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();

  const toC = (f: number) => Math.round(((f - 32) * 5) / 9);

  const current: CurrentWeather = {
    tempF: Math.round(json.current.temp),
    tempC: toC(json.current.temp),
    condition: json.current.weather?.[0]?.main ?? "Unknown",
    icon: json.current.weather?.[0]?.icon ?? "01d",
    humidity: json.current.humidity,
    windMph: Math.round(json.current.wind_speed),
  };

  const daily: DailyForecast[] = (json.daily ?? []).slice(0, 5).map((d: any) => ({
    date: new Date(d.dt * 1000).toISOString().slice(0, 10),
    highF: Math.round(d.temp.max),
    lowF: Math.round(d.temp.min),
    highC: toC(d.temp.max),
    lowC: toC(d.temp.min),
    condition: d.weather?.[0]?.main ?? "Unknown",
    icon: d.weather?.[0]?.icon ?? "01d",
  }));

  return { current, daily };
}

/** Resolves a free-text location ("Austin, TX") to lat/lon via OWM geocoding. */
export async function geocodeLocation(query: string): Promise<{ lat: number; lon: number; label: string } | null> {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) throw new Error("OPENWEATHER_API_KEY is not configured");

  const url = new URL("https://api.openweathermap.org/geo/1.0/direct");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "1");
  url.searchParams.set("appid", apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) return null;
  const json = await res.json();
  const first = json?.[0];
  if (!first) return null;

  return {
    lat: first.lat,
    lon: first.lon,
    label: [first.name, first.state, first.country].filter(Boolean).join(", "),
  };
}
