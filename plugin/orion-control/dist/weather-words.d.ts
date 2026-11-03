/** Celsius to Fahrenheit, rounded to a whole degree. */
export declare const toF: (celsius: number | string) => number;
/** "13°C (55°F)", "55°F", "55 F", "high 13°C", "46–55°F" become "55 degrees Fahrenheit", "a high of 55 degrees Fahrenheit", "46 to 55 degrees Fahrenheit". */
export declare function fahrenheitWords(text: string): string;
