import { CDPDomain } from '../types';

export const isCDPDomain = (domain: string): domain is CDPDomain => {
    return ['Page', 'Network', 'DOM', 'Runtime', 'Console'].includes(domain);
};
