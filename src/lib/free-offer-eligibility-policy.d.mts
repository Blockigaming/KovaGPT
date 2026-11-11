export type IntroOfferSummary={
 tier?:string|null;
 effectiveTier?:string|null;
 activeSubscriptionCount?:number|null;
 billingConflict?:boolean|null;
 billingSetupIncomplete?:boolean|null;
 trialing?:boolean|null;
};
export declare function canDisplayFreeIntroOffer(input?:{
 summary?:IntroOfferSummary|null;
 redeemed?:boolean|null;
 pendingClaim?:boolean|null;
 billingEnabled?:boolean|null;
 couponConfigured?:boolean|null;
}):boolean;
