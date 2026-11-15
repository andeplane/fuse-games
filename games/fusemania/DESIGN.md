# Fusemania scores

This direction applies to the high-scores route and its song leaderboard, not the gameplay, picker or shared navigation.

## Purpose

Players find a song, compare accuracy across difficulties, inspect its rankings and play that chart. One sortable table spans all packs. A song opens a dedicated detail view; Back restores the search, sort and focus.

## Visual system

Use a flat midnight-violet surface, warm white text and muted lavender secondary text. Mint identifies the play action and keyboard focus. Easy, Medium, Hard and Challenge retain restrained green, amber, rose and violet cues. The shared pixel logo remains the brand anchor; readable sans-serif type carries data and controls. Scores use tabular numerals.

The table has quiet row rules, consistent column alignment and clear song links. On narrow phones, each semantic row reflows into a title, pack/play metadata and four difficulty cells. No horizontal scrolling is needed. Controls remain ordinary search, selects, buttons and sortable headers.

## States

- A missing score offers a visible action; an unavailable chart has a dash and accessible explanation.
- Catalog and chart requests show loading, empty and retryable error states.
- Selection remains visible only on the chosen chart tab. Focus rings appear for keyboard use.
- Out-of-order responses, leaving a song and disposal invalidate pending chart reads.

## Data truth

Chart selection ranks by meter, source-difficulty rank and original index, keeping the four hardest without reindexing replay or storage IDs. Sparse, unambiguous standard chart labels are retained; Edit/duplicate/large chart sets fill ordered slots ending at Challenge.

Popularity counts newly completed, verified Score-mode runs on the current chart version, including non-improving replays. Existing boards have no historical play count; they start at zero. Guests and Battle runs are excluded. The count is not derived from the top-player list.
