/* Input shim for reference_probe.py. Functions under test come from the local DOS source. */
#include <stdio.h>
#include <string.h>
#include "GAMEDATA.H"

#define PASSWORD_MAX 16
#define FLAGS_KEYCARD_YELLOW (1 << 15)
#define FLAGS_KEYCARD_GREEN (1 << 14)
#define FLAGS_KEYCARD_BLUE (1 << 13)
#define FLAGS_KEYCARD_RED (1 << 12)
#define GUN_KNIFE 0
#define TextStringAt(...) ((void)0)
#define TextString(...) ((void)0)
#define TextStringWithTableAt(...) ((void)0)
#define DrawObjectiveInfo(...) ((void)0)
#define DisplayPlayer(...) ((void)0)
#define TextHeight() 8

struct CampaignOptions gCampaign;
struct CampaignSetting campaign;
struct GameOptions gOptions;
struct MissionOptions gMission;
struct Mission mission;
struct PlayerData gPlayer1Data, gPlayer2Data;
int missionTime;
char lastPassword[PASSWORD_MAX + 1];

/* DOS routines */

int main(void) {
    const char *titles[] = {
        "Bug-Eyed Monsters", "Ogre Rampage", "Distress call from scientific outpost",
        "The Brotherhood of Anarchy and Death", "Chambers of the deceased"
    };
    gCampaign.setting = &campaign;
    for (int i = 0; i < 5; i++) {
        strcpy(campaign.title, titles[i]);
        for (int cooperative = 0; cooperative < 2; cooperative++) {
            gOptions.twoPlayers = cooperative;
            for (int trial = 0; trial < 2; trial++) {
                gCampaign.seed = trial * 493;
                printf("%s, %d player(s), seed %d:", titles[i], 1 + cooperative, gCampaign.seed);
                for (int m = 1; m < 4; m++) printf(" %s", MakePassword(m));
                puts("");
            }
        }
    }
    gMission.missionData = &mission;
    mission.objectiveCount = 2;
    gMission.objectives[0] = (struct Objective){.count = 20, .required = 15, .done = 20};
    gMission.objectives[1] = (struct Objective){.count = 5, .required = 5, .done = 5};
    gMission.flags = FLAGS_KEYCARD_RED | FLAGS_KEYCARD_YELLOW;
    gPlayer1Data.survived = 1;
    gPlayer1Data.hp = 183;
    gPlayer1Data.kills = 7;
    gPlayer1Data.weaponCount = 1;
    gPlayer1Data.weapons[0] = GUN_KNIFE;
    gOptions.playerHp = 100;
    missionTime = 4915;
    Bonuses();
    printf("Objective, access and time subtotal: %d\n", gPlayer1Data.totalScore);
    Summary(0, &gPlayer1Data, 0);
    printf("With personal adjustments: %d\n", gPlayer1Data.totalScore);
    return 0;
}
