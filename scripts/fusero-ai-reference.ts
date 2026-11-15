/** Extract the native AI geometry/path kernels without translating their algorithm. */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
const source = process.argv[2];
if (!source)
  throw new Error(
    "usage: tsx scripts/fusero-ai-reference.ts /path/to/pinned/openlierox",
  );
/** Git blob ids from the pinned upstream tree, rather than trusting a directory label. */
const BLOBS: Readonly<Record<string, string>> = {
  "src/common/CWormBot.cpp": "48050363b6899dcf1532c796eb6c9e9b3f75b692",
  "include/CVec.h": "bb20b9887e1863ca7dc45650671a0f9296ecc7c4",
  "include/MathLib.h": "105d70edfda62292d0cd38d47ce970c8586e5ce7",
  "src/level/FastTraceLine.h": "63ecbe93aef039e6b46151f689d5a917044870f8",
};
const read = (path: string): string => {
  const data = readFileSync(join(source, path));
  const blob = createHash("sha1")
    .update(`blob ${data.length}\0`)
    .update(data)
    .digest("hex");
  if (blob !== BLOBS[path])
    throw new Error(`Pinned upstream blob mismatch: ${path}`);
  return data.toString("utf8");
};
function body(text: string, marker: string): string {
  const at = text.indexOf(marker);
  if (at < 0) throw new Error(`Missing source marker: ${marker}`);
  const open = text.indexOf("{", at);
  let depth = 1,
    end = open + 1;
  for (; depth && end < text.length; end++) {
    if (text[end] === "{") depth++;
    if (text[end] === "}") depth--;
  }
  return text.slice(at, end);
}
const ai = read("src/common/CWormBot.cpp"),
  vec = read("include/CVec.h"),
  math = read("include/MathLib.h");
let search = ai.slice(
  ai.indexOf("class searchpath_base {"),
  ai.indexOf("\n\t// this function will start the search"),
);
search = search
  .replace(body(search, "\tsearchpath_base() :"), "searchpath_base() {}")
  .replace(
    body(search, "\t~searchpath_base()"),
    "~searchpath_base() { clear(); }",
  )
  .replace(/\s*SDL_Delay\(1\);[^\n]*/g, "")
  .replace(/\s*if\(shouldBreakThread\(\).*return NULL;/g, "");
const kernels = [
  body(ai, "SquareMatrix<int> getMaxFreeArea("),
  body(ai, "NEW_ai_node_t* createNewAiNode(float"),
  body(ai, "NEW_ai_node_t* createNewAiNode(NEW_ai_node_t*"),
  body(ai, "NEW_ai_node_t* createNewAiNode(const VectorD2<int>&"),
  body(ai, "INLINE bool simpleTraceLine("),
];
const header = String.raw`/*
 * Source-extracted OpenLieroX AI differential oracle, LGPL.
 * Pinned source 0a20c6d0a10ed63b28a15f05c771913c294efbf6.
 * Jason Boettcher, Dark Charlie, Albert Zeyer and contributors.
 * Kernels below are upstream C++, not a copy of the TypeScript implementation.
 * Thread sleeps/cancellation are omitted for synchronous algorithm comparison.
 * Regenerate: pnpm exec tsx scripts/fusero-ai-reference.ts /path/to/pinned/source
 */
#include <algorithm>
#include <array>
#include <cmath>
#include <iostream>
#include <set>
#include <vector>
#include <string>
#define INLINE inline
#define MAX(a,b) std::max((a),(b))
#define MIN(a,b) std::min((a),(b))
using uchar = unsigned char;
using uint = unsigned int;
using std::endl;
namespace boost { template<class T,size_t N> using array=std::array<T,N>; }
struct Angle { double toRad()const{return 0;} static Angle fromRad(double){return {};} };
auto& errors=std::cerr; auto& warnings=std::cerr;
`;
const vector =
  vec.slice(
    vec.indexOf("template<typename _T>"),
    vec.indexOf("template<> VectorD2<int>"),
  ) + "\nusing CVec=VectorD2<float>;\n";
const matrix =
  "template<typename _T>\n" + body(math, "class SquareMatrix {") + ";\n";
const adapters = String.raw`
const int PX_EMPTY=1,PX_DIRT=2,PX_ROCK=4;
struct Material { int flags; int toLxFlags()const{return flags;} };
struct CMap {
 unsigned w,h; std::vector<std::vector<uchar>> pixels; std::vector<uchar*> lines;
 struct Image { uchar** line; } image; Image* material=&image;
 boost::array<Material,256> materials;
 CMap(unsigned w,unsigned h):w(w),h(h),pixels(h,std::vector<uchar>(w)),lines(h) {
  for(unsigned i=0;i<256;i++)materials[i].flags=i;
  for(unsigned i=0;i<h;i++)lines[i]=pixels[i].data();image.line=lines.data();
 }
 unsigned GetWidth(){return w;} unsigned GetHeight(){return h;}
 auto& materialArray(){return materials;}
 void lockFlags(bool){} void unlockFlags(bool){} bool isLoaded(){return true;}
 const Material& unsafeGetMaterial(int x,int y){return materials[pixels[y][x]];}
 uchar GetPixelFlag(int x,int y){return x<0||y<0||x>=(int)w||y>=(int)h?PX_ROCK:pixels[y][x];}
};
struct Game {CMap* map=nullptr; CMap* gameMap(){return map;}} game;
float NormalizeVector(CVec* p){float l=sqrtf(p->x*p->x+p->y*p->y);if(l){p->x/=l;p->y/=l;}return l;}
int traceWormLine(CVec target,CVec start,CVec* collision=nullptr);
static const unsigned short wormsize=7;
`;
const fast =
  "template<class _action>\n" +
  body(read("src/level/FastTraceLine.h"), "void fastTraceLine(");
const nodes = body(ai, "struct NEW_ai_node_t {") + ";\n";
const trace =
  body(ai, "class set_col_and_break {") +
  ";\n" +
  body(ai, "int traceWormLine(CVec target, CVec start, CVec* collision)");
const coarse = body(
  ai,
  "int CWorm::traceLine(CVec target, CVec start,",
).replace("CWorm::traceLine", "coarseTrace");
const finish = [
  "void completeNodesInfo(",
  "void splitUpNodes(",
  "void simplifyPath(",
]
  .map((marker) => body(ai, marker))
  .join("\n");
const runner = String.raw`
public:
std::vector<int> equalScoreFixture() {
 target=VectorD2<int>(100,100);
 area_item* a=new area_item(this,SquareMatrix<int>(VectorD2<int>(10,10),VectorD2<int>(20,20)));
 area_item* b=new area_item(this,SquareMatrix<int>(VectorD2<int>(0,0),VectorD2<int>(28,28)));
 area_item* c=new area_item(this,SquareMatrix<int>(VectorD2<int>(70,70),VectorD2<int>(90,90)));
 for(auto item:{a,b,c}){item->initChecklists();areas.insert(item);}
 b->dist_from_source=1000;
 c->dist_from_source=b->expected_min_total_dist()-(c->area.getCenter()-target).GetLength();
 areas_stack.insert(a);areas_stack.insert(c);areas_stack.erase(a);a->process();
 std::vector<int> result;for(auto item:areas_stack)result.push_back(item==a?0:item==b?1:2);return result;
}
std::vector<CVec> run(VectorD2<int> s, VectorD2<int> t) {
 start=s;target=t;NEW_ai_node_t* p=findPath(start);completeNodesInfo(p);simplifyPath(p);splitUpNodes(p,nullptr);
 std::vector<CVec> result;for(;p;p=p->psNext)result.push_back(CVec(p->fX,p->fY));return result;
}
};
int main(){
 std::cout.precision(17);int width,height;std::cin>>width>>height;CMap map(width,height);game.map=&map;
 for(int y=0;y<height;y++){std::string line;std::cin>>line;for(int x=0;x<width;x++)map.pixels[y][x]=line[x]=='#'?PX_ROCK:line[x]=='d'?PX_DIRT:PX_EMPTY;}
 std::string op;float sx,sy,tx,ty;
 while(std::cin>>op>>sx>>sy>>tx>>ty){
  if(op=="path"){searchpath_base s;auto p=s.run(VectorD2<int>((int)sx,(int)sy),VectorD2<int>((int)tx,(int)ty));std::cout<<p.size();for(auto v:p)std::cout<<" "<<v.x<<" "<<v.y;std::cout<<"\n";}
  if(op=="area"){auto r=getMaxFreeArea(VectorD2<int>((int)sx,(int)sy),PX_ROCK);std::cout<<r.v1.x<<" "<<r.v1.y<<" "<<r.v2.x<<" "<<r.v2.y<<"\n";}
  if(op=="trace"){CVec c;int clear=traceWormLine(CVec(tx,ty),CVec(sx,sy),&c);std::cout<<clear<<" "<<c.x<<" "<<c.y<<"\n";}
  if(op=="coarse"){CVec start(sx,sy),target(tx,ty);int type;int res=coarseTrace(target,start,&type,5,PX_EMPTY);float dist=0;if(res)dist=(float)((int)(start-target).GetLength()/res);std::cout<<res<<" "<<type<<" "<<dist<<"\n";}
  if(op=="tie"){searchpath_base s;auto result=s.equalScoreFixture();std::cout<<result.size();for(auto id:result)std::cout<<" "<<id;std::cout<<"\n";}
 }
}
`;
writeFileSync(
  "games/fusero/tests/fixtures/classic-ai-native.cpp",
  [
    header,
    vector,
    matrix,
    adapters,
    fast,
    nodes,
    ...kernels,
    trace,
    coarse,
    search,
    finish,
    runner,
  ]
    .join("\n")
    .replace(/[ \t]+$/gm, "")
    .trimEnd() + "\n",
);
