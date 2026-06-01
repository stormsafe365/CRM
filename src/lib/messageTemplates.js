// Quick-insert message templates from Jenna's follow-up playbook
// (stormsafe_followup_templates.md). Customer-facing copy — swap [First Name]
// and [Your Name] before sending. Dropping one into an activity note documents
// what was actually sent. Internal-tone items are marked.

export const MESSAGE_TEMPLATES = [
  {
    label: '+3 days · nice to meet',
    text: `Hi [First Name], it's [Your Name] with StormSafe Steel — really enjoyed talking through your building with you. No rush on anything; I just wanted you to have my number handy in case questions pop up while you think it over. Here whenever you need me.`,
  },
  {
    label: '+2 weeks · light check-in',
    text: `Hi [First Name], just floating back to the top of your inbox — no pressure at all. If anything's come up about your project, or you'd like me to tweak the quote, I'm one text away. Hope you're doing well!`,
  },
  {
    label: 'Monthly · value touch (+photo)',
    text: `Hey [First Name] — we just finished one a lot like what you're after and I thought of your project. Sending a pic so you can picture it. Still here whenever the timing's right — no rush at all.`,
  },
  {
    label: 'Long wait · reassurance',
    text: `Hi [First Name], it's been a little while so I wanted to say hello — totally no pressure. Most folks take a few months to land on the right time, and that's completely normal. Your quote's still good and I'll be here when you're ready.`,
  },
  {
    label: 'Reason to reach out (price/season/permits)',
    text: `Hey [First Name] — quick heads-up: [steel pricing's been holding steady / we're heading into a busy install season / permit timelines are moving fast right now], so if you've been on the fence it's a good window. No pressure either way — just didn't want you to miss it.`,
  },
  {
    label: 'Graceful step-back (gone quiet)',
    text: `Hi [First Name], I don't want to crowd your inbox, so I'll ease off for a bit — just know the door's always open and your quote's here whenever life makes room for it. Take care, and reach out anytime.`,
  },
  {
    label: 'Ordered · production update',
    text: `Hi [First Name]! Quick update on your building — [the factory's confirmed your order and it's in the production queue / your unit is being built now]. I'll keep you posted as it moves along. Reach out anytime with questions.`,
  },
  {
    label: 'Ordered · install scheduled',
    text: `Great news [First Name] — your install is set for [date]! I'll send a quick reminder a day or two before, and I'm just a text away if anything comes up between now and then. Can't wait to get this up for you.`,
  },
  {
    label: 'Factory · status check (internal)',
    text: `Hi [Contact] — checking in on order [#] for [customer / jobsite]. Can you confirm the current production status and an estimated ship/install window? Appreciate it, thank you!`,
  },
  {
    label: 'Ordered · heard from factory',
    text: `Hi [First Name] — just heard from the manufacturer: [update]. Wanted to pass it along right away. Everything's on track and I'll check back in [timeframe].`,
  },
]
