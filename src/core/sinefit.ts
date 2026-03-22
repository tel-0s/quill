export interface SineFitResult {
	/** R² of the best single-frequency sine fit (0–1). */
	r2: number;
	/** Best-fit frequency in cycles per sequence length. */
	frequency: number;
	/** Best-fit period in data points. */
	period: number;
	/** Best-fit phase in radians. */
	phase: number;
	/** Best-fit amplitude (in units of the input signal). */
	amplitude: number;
}

export interface WindowedFitResult {
	/** Null-corrected mean score (0 = indistinguishable from noise, 1 = perfect sine). */
	score: number;
	/** Raw mean R² before null correction. */
	rawMeanR2: number;
	/** Peak window R² (raw). */
	peakR2: number;
	/** Best-fit period from the peak window, in sentences. */
	bestPeriod: number;
	/** Best-fit amplitude from the peak window. */
	bestAmplitude: number;
}

const MIN_POINTS = 6;

function harmonicNumber(k: number): number {
	let h = 0;
	for (let i = 1; i <= k; i++) h += 1 / i;
	return h;
}

/**
 * Expected R² of the max-power frequency under white noise for a
 * sequence of length N. Derived from the periodogram: each of the
 * floor(N/2) frequencies contributes ~Exp(2/N) power, and the expected
 * maximum of K iid Exp(mu) variables is mu * H_K.
 */
function nullExpectedR2(n: number): number {
	const k = Math.floor(n / 2);
	if (k < 1) return 0;
	return (2 / n) * harmonicNumber(k);
}

/**
 * Fit the best single-frequency sine wave to a numeric sequence.
 * Scans integer frequencies 1..floor(N/2), projecting the mean-centered
 * signal onto sin/cos basis pairs and picking the peak.
 */
export function fitSine(values: number[]): SineFitResult {
	const n = values.length;
	if (n < MIN_POINTS) {
		return { r2: 0, frequency: 0, period: 0, phase: 0, amplitude: 0 };
	}

	const mean = values.reduce((a, b) => a + b, 0) / n;
	const centered = values.map((v) => v - mean);
	const ssTot = centered.reduce((acc, v) => acc + v * v, 0);

	if (ssTot < 1e-12) {
		return { r2: 0, frequency: 0, period: 0, phase: 0, amplitude: 0 };
	}

	let bestR2 = 0;
	let bestFreq = 1;
	let bestA = 0;
	let bestB = 0;

	const maxFreq = Math.floor(n / 2);
	for (let f = 1; f <= maxFreq; f++) {
		let sinSum = 0;
		let cosSum = 0;
		const omega = (2 * Math.PI * f) / n;

		for (let i = 0; i < n; i++) {
			sinSum += centered[i]! * Math.sin(omega * i);
			cosSum += centered[i]! * Math.cos(omega * i);
		}

		const a = (2 / n) * sinSum;
		const b = (2 / n) * cosSum;
		const power = (n / 2) * (a * a + b * b);
		const r2 = power / ssTot;

		if (r2 > bestR2) {
			bestR2 = r2;
			bestFreq = f;
			bestA = a;
			bestB = b;
		}
	}

	const amplitude = Math.sqrt(bestA * bestA + bestB * bestB);
	const phase = Math.atan2(bestB, bestA);

	return {
		r2: Math.min(Math.round(bestR2 * 1000) / 1000, 1),
		frequency: bestFreq,
		period: Math.round((n / bestFreq) * 10) / 10,
		phase: Math.round(phase * 1000) / 1000,
		amplitude: Math.round(amplitude * 100) / 100,
	};
}

/**
 * Sliding-window sine fit.  For each window position, fit the best sine
 * and record R².  The final score is the mean R² across all windows,
 * corrected by subtracting the null-model expectation (what random noise
 * would score) and rescaling so 0 = noise, 1 = perfect rhythm.
 *
 * This captures *local* rhythmic variation: a writer doesn't need to
 * maintain one global period — they just need consistent local cadence.
 */
export function fitSineWindowed(
	values: number[],
	windowSize: number,
): WindowedFitResult {
	const n = values.length;
	const empty: WindowedFitResult = {
		score: 0, rawMeanR2: 0, peakR2: 0, bestPeriod: 0, bestAmplitude: 0,
	};

	if (n < MIN_POINTS) return empty;

	const w = Math.max(MIN_POINTS, Math.min(windowSize, n));

	if (n <= w) {
		const fit = fitSine(values);
		const nullR2 = nullExpectedR2(n);
		const corrected = nullR2 >= 1 ? 0 : Math.max(0, (fit.r2 - nullR2) / (1 - nullR2));
		return {
			score: Math.round(corrected * 1000) / 1000,
			rawMeanR2: fit.r2,
			peakR2: fit.r2,
			bestPeriod: fit.period,
			bestAmplitude: fit.amplitude,
		};
	}

	const nullR2 = nullExpectedR2(w);
	let r2Sum = 0;
	let peakR2 = 0;
	let peakFit: SineFitResult | null = null;
	const windowCount = n - w + 1;

	for (let start = 0; start < windowCount; start++) {
		const window = values.slice(start, start + w);
		const fit = fitSine(window);
		r2Sum += fit.r2;
		if (fit.r2 > peakR2) {
			peakR2 = fit.r2;
			peakFit = fit;
		}
	}

	const rawMean = r2Sum / windowCount;
	const corrected = nullR2 >= 1 ? 0 : Math.max(0, (rawMean - nullR2) / (1 - nullR2));

	return {
		score: Math.round(corrected * 1000) / 1000,
		rawMeanR2: Math.round(rawMean * 1000) / 1000,
		peakR2: Math.round(peakR2 * 1000) / 1000,
		bestPeriod: peakFit?.period ?? 0,
		bestAmplitude: peakFit?.amplitude ?? 0,
	};
}
