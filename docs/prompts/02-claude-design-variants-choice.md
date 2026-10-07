# Claude Design prompt — "Choose your version" (variants)

Paste everything below the line into Claude Design. It builds on [`01-claude-design-genesis-ui.md`](01-claude-design-genesis-ui.md); the designer should already have that brief. Backend decisions behind this feature are in [`../13-variants-feature.md`](../13-variants-feature.md).

---

# Design brief: "Choose your version" for Genesis

You already know Genesis: an AI app builder for HighLevel. A signed-in user describes an app in chat, and the AI writes it and shows it running on their real HighLevel data. Keep everything from the existing Genesis design language: the restraint, the "no AI slop" rules, light and dark themes, shadcn-vue and Tailwind primitives, and the plain, factual tone.

## What's new

Until now our users have been technical: agency owners, CRM admins, solutions engineers. We're opening Genesis to **business owners**. They know their business and HighLevel, but they don't write code, don't care how the app is built, and judge it the way they'd judge any product: does it look right, does it show my real information, and is it easy to use.

The new feature is this: when an owner sends the **first** prompt in a new project, Genesis doesn't produce one app. It makes **four different versions** of what they asked for, tests and scores them behind the scenes, and shows the **best two**. Each shows a **score**. The owner looks at both running on their own data and **picks the one they like**. The one they pick becomes their project, and from then on the project works as it does today (chat, code, preview, version history).

## What the owner should experience

- They ask for something in plain words, for example "Make a dashboard which shows the list of appointments for me."
- They wait a short while (typically a couple of minutes). They should understand that Genesis is working, roughly what stage it's at, and that it's worth waiting for. They should never feel the app has frozen.
- They are then shown **two options** and asked to choose. They can see how each looks and behaves **on their own real data**, not as a screenshot or mock-up.
- Each option carries **a score**. One of them is marked as **our top pick** (the higher score).
- They choose, receive a confirmation, and move straight on into their project with only that version. The other option is gone.

The owner should come away feeling they were given a real choice and a trustworthy recommendation, without needing to understand how it was produced.

## About the scores

- Each option shows an **overall score out of 100**, plus **four smaller scores**:
  - **Works**: does it show the right information, and does it handle empty, loading and error situations?
  - **Looks polished**: visual quality, layout, readability, and how well it adapts to different screen sizes.
  - **Matches your request**: how well it does what the owner asked.
  - **Easy to use**: how clear it is for someone who isn't technical.
- **Show only the scores.** No written reasons, explanations, breakdown lists or technical detail.
- The top pick is a recommendation and not a verdict. The owner is free to prefer the lower-scored option, and the design should respect that. Please think about how to make the score feel credible and useful without overclaiming (for instance, we are not saying one is "correct").
- What the scores look like is yours to decide: numbers, bars, rings or something else. Remember the owner is non-technical and the interface must not read as a test report.

## Moments to design

1. **Starting.** The owner has an empty project and a new, non-technical audience. Consider how the empty project and its example prompts should change for business owners.
2. **Working.** The wait while four versions are made and scored. The server reports progress at a coarse level, such as understanding the request, creating versions, testing and scoring. No partial results are shown during this time. The owner should be able to leave and come back, and refresh the page, without losing anything.
3. **The choice.** Two options, each running on real data, each with a score, one marked as the top pick. The owner can look closely at each and can compare them. This is the main screen of the feature.
4. **Choosing and confirmation.** When the owner picks a version, they receive a clear confirmation that this version is now their project. From that point **only the chosen version is shown**. The other option is not displayed, not linked, and not available to go back to. The choice is final from the owner's point of view. Design the confirmation, and the transition from the choice screen into the existing workspace. Think about what the owner needs to feel at this moment: certainty about what they picked, and a clear next step. The owner should not wonder where the other version went.
5. **Things that don't go to plan:**
   - Only **one** good version came out of the four.
   - **None** of the versions were good enough to show. The owner can retry for free.
   - The run **failed or was interrupted** partway through.
   - The owner has hit their **limit** for how many times they can do this, or the feature is **temporarily paused**. The owner needs to know when to try again.
   - **HighLevel isn't connected**, so the options can't show the owner's real data. This matters because the owner's judgement relies on real data.
   - The owner leaves before choosing and returns later. Their two options are still waiting for them.
   - The owner wants neither and chooses to discard everything.
6. **Follow-ups.** After they choose, the project behaves as it does today. Subsequent prompts produce one result, not four. The design should make it clear why the first prompt behaved differently and the later ones don't.

## Things we want you to think about

- Previewing two live apps side by side, versus one at a time. Narrow screens (~390) matter too, because owners use phones.
- How an owner who has never seen code decides between two designs, and what helps them decide.
- Because the choice is final, the owner should get a **chance to double-check before it is made**. We do not want a pop-up confirmation dialog. We want a lighter, in-place way to check, with the options still in view. How it works, what it says, and how much friction it adds are for you to design. Tell us if you think something else would serve owners better.
- How much of the usual workspace (chat, code panel, file tree) should be visible or hidden at this stage, given this audience.
- Anything in the current workspace that confuses a non-technical owner and should be hidden or reworded for them.

## What we're not deciding for you

Layout, navigation, component choices, how the score is drawn, what words to use for the stages, and how the two previews are arranged are all open. Design it as you think is best. Tell us where you made a call that you'd like us to challenge.

## Constraints that do apply

- Standard shadcn-vue and Tailwind primitives, no exotic widgets.
- Light and dark, both considered.
- Plain, factual language. No marketing copy, no sparkles, no "AI magic".
- Accessibility: visible keyboard focus, readable contrast, and no meaning carried by color alone. This applies to the scores and the top-pick marker too.
- Use realistic content, such as a real-looking appointments dashboard for a clinic or salon, and real-looking names and times. No lorem ipsum.

## Deliverables

- The moments above, in light and dark, at desktop (~1440) and narrow (~390) widths.
- The "choice" screen with realistic data in both options.
- The double-check before the choice is made, and the confirmation after choosing.
- The first view of the workspace with only the chosen version.
- Every failure and limit state listed above.
- A short note on any new foundations or components you introduced for scores and the top-pick marker, and on anything you'd change in the existing design to suit business owners.
