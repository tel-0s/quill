/**
 * Detrended Fluctuation Analysis (DFA) and Multifractal DFA (MF-DFA).
 *
 * DFA measures long-range correlations in a time series via a scaling
 * exponent α (the Hurst parameter).  Unlike sine fitting, it doesn't
 * assume periodicity — it captures structured variation at multiple
 * scales, which is how prose rhythm actually works.
 *
 * MF-DFA extends this by computing the scaling exponent h(q) for
 * different moment orders q, revealing whether the signal has
 * multifractal structure (rich variation at multiple intensity levels).
 */

export interface DfaResult {
	/** Standard DFA exponent h(2). 0.5=noise, ~0.75=structured, 1.0=1/f, 1.5=Brownian. */
	alpha: number;
	/** R² of the log-log fit (how well the power-law scaling holds). */
	fitR2: number;
	/** Multifractal spectrum width: h(q_min) - h(q_max). 0 = monofractal. */
	spectrumWidth: number;
	/** Flow score derived from α and spectrum width (0–1). */
	score: number;
}

const MIN_SCALE = 4;
const MIN_DATA_POINTS = 16;
const Q_VALUES = [-3, -1, 0, 1, 2, 3];

function buildProfile(values: number[]): number[] {
	const n = values.length;
	const mean = values.reduce((a, b) => a + b, 0) / n;
	const profile: number[] = [];
	let cumSum = 0;
	for (const v of values) {
		cumSum += v - mean;
		profile.push(cumSum);
	}
	return profile;
}

function generateScales(n: number): number[] {
	const maxScale = Math.floor(n / 4);
	if (maxScale < MIN_SCALE) return [];

	const numScales = Math.min(20, maxScale - MIN_SCALE + 1);
	const logMin = Math.log(MIN_SCALE);
	const logMax = Math.log(maxScale);
	const seen = new Set<number>();
	const scales: number[] = [];

	for (let i = 0; i < numScales; i++) {
		const logS = logMin + (logMax - logMin) * i / (numScales - 1);
		const s = Math.round(Math.exp(logS));
		if (s >= MIN_SCALE && s <= maxScale && !seen.has(s)) {
			seen.add(s);
			scales.push(s);
		}
	}
	return scales;
}

/**
 * Compute detrended variance for each non-overlapping segment of the
 * profile at a given scale.  Uses both forward and backward passes
 * to avoid wasting data at the boundary.
 */
function segmentVariances(profile: number[], scale: number): number[] {
	const n = profile.length;
	const numSeg = Math.floor(n / scale);
	if (numSeg < 1) return [];

	const variances: number[] = [];

	const computeVariance = (start: number): number => {
		let sx = 0, sy = 0, sxx = 0, sxy = 0;
		for (let i = 0; i < scale; i++) {
			sx += i;
			sy += profile[start + i]!;
			sxx += i * i;
			sxy += i * profile[start + i]!;
		}
		const denom = scale * sxx - sx * sx;
		const b = denom === 0 ? 0 : (scale * sxy - sx * sy) / denom;
		const a = (sy - b * sx) / scale;

		let v = 0;
		for (let i = 0; i < scale; i++) {
			const residual = profile[start + i]! - (a + b * i);
			v += residual * residual;
		}
		return v / scale;
	};

	for (let seg = 0; seg < numSeg; seg++) {
		variances.push(computeVariance(seg * scale));
	}
	for (let seg = 0; seg < numSeg; seg++) {
		variances.push(computeVariance(n - (seg + 1) * scale));
	}

	return variances;
}

/**
 * Compute the q-th order fluctuation function F_q(s) from segment variances.
 */
function fluctuationFunction(variances: number[], q: number): number {
	const ns = variances.length;
	if (ns === 0) return 0;

	if (q === 0) {
		let logSum = 0;
		for (const v of variances) {
			logSum += Math.log(Math.max(v, 1e-20));
		}
		return Math.exp(logSum / (2 * ns));
	}

	const halfQ = q / 2;
	let sum = 0;
	for (const v of variances) {
		sum += Math.pow(Math.max(v, 1e-20), halfQ);
	}
	return Math.pow(sum / ns, 1 / q);
}

/**
 * Ordinary least squares on log-log data. Returns { slope, r2 }.
 */
function logLogRegression(
	scales: number[],
	values: number[],
): { slope: number; r2: number } {
	const n = scales.length;
	if (n < 3) return { slope: 0.5, r2: 0 };

	const logX = scales.map((s) => Math.log(s));
	const logY = values.map((v) => Math.log(Math.max(v, 1e-20)));

	const mx = logX.reduce((a, b) => a + b, 0) / n;
	const my = logY.reduce((a, b) => a + b, 0) / n;

	let sxx = 0, sxy = 0, syy = 0;
	for (let i = 0; i < n; i++) {
		const dx = logX[i]! - mx;
		const dy = logY[i]! - my;
		sxx += dx * dx;
		sxy += dx * dy;
		syy += dy * dy;
	}

	const slope = sxx === 0 ? 0 : sxy / sxx;
	const r2 = syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);

	return { slope, r2 };
}

/**
 * Map the DFA exponent α to a 0–1 score.
 * Peaks at 0.75.  Tighter sigmas than before: below 0.6 or above 1.0
 * the score drops meaningfully.  Asymmetric — slightly more forgiving
 * toward 1/f (α≈1.0) than toward pure noise (α≈0.5).
 */
function alphaToScore(alpha: number): number {
	const target = 0.75;
	const diff = alpha - target;
	const sigma = diff > 0 ? 0.22 : 0.16;
	return Math.exp(-0.5 * (diff / sigma) ** 2);
}

/**
 * Coefficient of variation → variation-sufficiency factor (0–1).
 *
 * DFA tells us the *structure* of variation, but not whether there's
 * *enough*.  Monotonous text (all simple sentences, all ~20 words)
 * can have a nice α if its tiny fluctuations correlate well.  This
 * factor ensures the score reflects actual perceptible variation.
 *
 * Uses an exponential ramp: rises quickly from 0 to 1 as CV grows.
 *   cv ≈ 0   → 0     (no variation — no flow, period)
 *   cv ≈ 0.15 → 0.63
 *   cv ≈ 0.30 → 0.86
 *   cv > 0.50 → ~1.0  (sufficient variation, no further bonus)
 */
function variationFactor(values: number[]): number {
	const n = values.length;
	if (n < 2) return 0;
	const mean = values.reduce((a, b) => a + b, 0) / n;
	if (Math.abs(mean) < 1e-12) {
		const allZero = values.every((v) => Math.abs(v) < 1e-12);
		if (allZero) return 0;
	}
	const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n;
	const std = Math.sqrt(variance);
	const denom = Math.max(Math.abs(mean), std, 1e-12);
	const cv = std / denom;
	return 1 - Math.exp(-cv / 0.15);
}

/**
 * Run DFA and MF-DFA on a numeric time series.
 */
export function computeDfa(values: number[]): DfaResult {
	const n = values.length;
	if (n < MIN_DATA_POINTS) {
		return { alpha: 0.5, fitR2: 0, spectrumWidth: 0, score: 0 };
	}

	const profile = buildProfile(values);
	const scales = generateScales(n);
	if (scales.length < 3) {
		return { alpha: 0.5, fitR2: 0, spectrumWidth: 0, score: 0 };
	}

	const variancesByScale = scales.map((s) => segmentVariances(profile, s));

	const hOfQ = new Map<number, number>();
	for (const q of Q_VALUES) {
		const fqValues = variancesByScale.map((vars) => fluctuationFunction(vars, q));
		const { slope } = logLogRegression(scales, fqValues);
		hOfQ.set(q, slope);
	}

	const alpha = hOfQ.get(2) ?? 0.5;

	const fq2Values = variancesByScale.map((vars) => fluctuationFunction(vars, 2));
	const { r2: fitR2 } = logLogRegression(scales, fq2Values);

	const hValues = Array.from(hOfQ.values());
	const hMax = Math.max(...hValues);
	const hMin = Math.min(...hValues);
	const spectrumWidth = Math.round(Math.max(0, hMax - hMin) * 1000) / 1000;

	const aScore = alphaToScore(alpha);
	const vFactor = variationFactor(values);
	const modulatedAlpha = aScore * (0.3 + 0.7 * vFactor);
	const widthBonus = Math.min(1, spectrumWidth / 0.5);
	const compositeScore = 0.75 * modulatedAlpha + 0.25 * widthBonus;

	return {
		alpha: Math.round(alpha * 1000) / 1000,
		fitR2: Math.round(fitR2 * 1000) / 1000,
		spectrumWidth,
		score: Math.round(Math.max(0, Math.min(1, compositeScore)) * 1000) / 1000,
	};
}
