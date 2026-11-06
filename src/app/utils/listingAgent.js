import { isPlaceholderAvatar } from './avatar';

/**
 * The ONE place that decides which agent a buyer-facing listing presents.
 *
 * A property carries two different identities and they must never be mixed up:
 *   - `userId` (and `createdByUid`) = the account that owns / created the listing. For a listing an
 *     administrator creates on an agent's behalf this can be the ADMIN. It is for billing, permissions
 *     and audit only.
 *   - `agentId` (+ denormalised `agentName` / `agentAvatar`) = the agent ASSIGNED to the listing.
 *
 * When a listing has an assigned agent (`agentId`), everything personal on the buyer page (name, photo,
 * phone, email) is that agent's. The owner's personal details are never a fallback: a missing assigned
 * photo is a placeholder, and a missing phone/email is simply not shown. Only when no agent is assigned
 * is the owner's profile the listing agent (the ordinary agent-lists-their-own-property case).
 *
 * Pure and display-only: nothing is written, so it corrects every existing listing as soon as it ships.
 *
 * @param {object} args
 * @param {object} args.property       the properties/{id} document
 * @param {object} [args.ownerProfile] public profile of property.userId
 * @param {object} [args.rosterAgent]  agents/{property.agentId} document, if it could be read
 * @param {object} [args.directoryAgent] the assigned agent's office-directory public profile, if uniquely resolved
 * @returns {{ assigned: boolean, firstName: string, lastName: string, avatar: string|null,
 *            phone: string|null, email: string|null }}
 */
export function resolveListingAgent({ property, ownerProfile, rosterAgent, directoryAgent } = {}) {
  const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

  if (property?.agentId) {
    const directoryName = [clean(directoryAgent?.firstName), clean(directoryAgent?.lastName)].filter(Boolean).join(' ');
    const name = directoryName || clean(property.agentName) || clean(rosterAgent?.name);
    const avatar = clean(directoryAgent?.avatar) || clean(property.agentAvatar) || clean(rosterAgent?.avatar);
    return {
      assigned: true,
      firstName: name || '',
      lastName: '',
      avatar: isPlaceholderAvatar(avatar) ? null : avatar,
      phone: clean(directoryAgent?.phone) || clean(rosterAgent?.phone),
      email: clean(rosterAgent?.email),
    };
  }

  return {
    assigned: false,
    firstName: clean(ownerProfile?.firstName) || '',
    lastName: clean(ownerProfile?.lastName) || '',
    avatar: clean(ownerProfile?.avatar),
    phone: clean(ownerProfile?.phone),
    email: null,
  };
}

/** Name + avatar for the listing cards (/listings, homepage). Same rules as the buyer page. */
export function listingCardAgent({ property, accountAgent, rosterAgent }) {
  const r = resolveListingAgent({ property, ownerProfile: accountAgent, rosterAgent });
  return { displayName: [r.firstName, r.lastName].filter(Boolean).join(' '), displayAvatar: r.avatar };
}
