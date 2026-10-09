import type { PageViewport } from 'pdfjs-dist';
import type { PageInfo } from '@shared/types';

/** Props received by PageView and by each of its three layers (plan §4.5). */
export type LayerProps = { page: PageInfo; viewport: PageViewport };
