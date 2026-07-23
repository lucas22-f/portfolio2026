import manifestJson from '../../../../../content/v1/reviewed-manifest.json';
import sourceJson from '../../../../../content/v1/cv-source.json';
import portfolioJson from '../../../../../content/v1/portfolio.json';

import { loadPortfolioPresentation } from './portfolio-content';

describe('portfolio presentation adapter', () => {
  it('exposes the content version only after validating the checked-in bundle', async () => {
    const bundle = await loadPortfolioPresentation(portfolioJson, manifestJson, sourceJson);

    expect(bundle.contentVersion).toBe(
      '838caac152b56d2a6c5a99094c05b2385a00dec65693b80d621f2eeebcc3d43c',
    );
    expect(bundle.portfolio.locale).toBe('es');
    expect(bundle.portfolio.records).toHaveLength(18);
  });

  it('rejects a presentation bundle whose portfolio version was tampered with', async () => {
    const tamperedPortfolio = structuredClone(portfolioJson);
    tamperedPortfolio.content_version = '0'.repeat(64);

    await expect(
      loadPortfolioPresentation(tamperedPortfolio, manifestJson, sourceJson),
    ).rejects.toThrow('Content version mismatch.');
  });
});
