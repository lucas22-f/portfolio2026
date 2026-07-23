import manifestJson from '../../../../../content/v1/reviewed-manifest.json';
import sourceJson from '../../../../../content/v1/cv-source.json';
import portfolioJson from '../../../../../content/v1/portfolio.json';

import { PortfolioKind, ValidatedContentBundle, validateContentBundle } from './content-validator';

export function loadPortfolioPresentation(): Promise<ValidatedContentBundle>;
export function loadPortfolioPresentation(
  portfolioInput: unknown,
  manifestInput: unknown,
  sourceInput: unknown,
): Promise<ValidatedContentBundle>;
export function loadPortfolioPresentation(
  ...inputs: [] | [unknown, unknown, unknown]
): Promise<ValidatedContentBundle> {
  if (inputs.length === 3) {
    return validateContentBundle(inputs[0], inputs[1], inputs[2]);
  }

  productionPresentation ??= validateContentBundle(portfolioJson, manifestJson, sourceJson);
  return productionPresentation;
}

let productionPresentation: Promise<ValidatedContentBundle> | undefined;

export function recordsByKind(bundle: ValidatedContentBundle, kind: PortfolioKind) {
  return bundle.portfolio.records.filter((record) => record.kind === kind);
}
