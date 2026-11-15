/*
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

template<typename _T>
struct VectorD2 {
	typedef _T manip_t; // Gus BaseVec compatibility
	typedef _T Type;

	// Constructor
	VectorD2() : x(0), y(0) {}
	VectorD2(_T _x, _T _y) : x(_x), y(_y) {}

	template<typename _T2>
	VectorD2(const VectorD2<_T2>& cp) {
		x = (_T)cp.x; y = (_T)cp.y;
	}

	// clockwise direction. starting at top (12 o'clock), i.e. (0,-1)
	VectorD2(Angle angle, double length = 1)
	{
		double radians = angle.toRad();
		x = (_T)(sin(radians) * length);
		y = (_T)(-cos(radians) * length);
	}


	// Attributes
	_T	x, y;


	// Methods

	float GetLength() const { return sqrtf((float)x*x + (float)y*y); }
	_T GetLength2() const { return x*x + y*y; }

	float GetAngle() const { return (float)atan2((float)y,(float)x); }

	VectorD2 Normalize() { return *this/GetLength(); }

	_T Scalar(const VectorD2& vec) const { return x*vec.x + y*vec.y; }

	VectorD2 orthogonal() const { return VectorD2(y, -x); }

	_T Cross(const VectorD2& oth) const { return x * oth.y - y * oth.x; }

	_T dotProduct(VectorD2 const& A) const
	{
		return x * A.x + y * A.y;
	}

	_T perpDotProduct(VectorD2 const& A) const
	{
		return x * A.y - y * A.x;
	}

	VectorD2 perp() const
	{
		return VectorD2(-y, x);
	}

	double length() const
	{
		return sqrt((double)(x*x + y*y));
	}

	VectorD2 normal() const
	{
		double invLength = 1.0 / length();
		return VectorD2((_T)(invLength*x), (_T)(invLength*y));
	}

	_T lengthSqr() const
	{
		return x*x + y*y;
	}

	// equivalent to Angle-constructor.
	Angle getAngle() const
	{
		return Angle::fromRad( atan2(double(x), double(-y)) );
	}

	// Overloads
	template<typename _T2>
	VectorD2 operator*(_T2 scalar) const {
		return VectorD2(_T(x*scalar),_T(y*scalar));
	}
	VectorD2 multPairwise(_T _x, _T _y) const {
		return VectorD2(x*_x, y*_y);
	}
	template<typename _T2>
	VectorD2 operator/(_T2 scalar) const {
		return VectorD2(_T(x/scalar),_T(y/scalar));
	}
	VectorD2 operator+(const VectorD2& vec) const {
		return VectorD2(x+vec.x,y+vec.y);
	}
	VectorD2 operator-(const VectorD2& vec) const {
		return VectorD2(x-vec.x,y-vec.y);
	}
	VectorD2 operator-() const {
		return VectorD2(-x,-y);
	}
	VectorD2& operator+=(const VectorD2& vec) {
		*this = *this + vec;
		return *this;
	}
	VectorD2& operator-=(const VectorD2& vec) {
		*this = *this - vec;
		return *this;
	}
	template<typename _T2>
	VectorD2& operator*=(_T2 scalar) {
		*this = *this * scalar;
		return *this;
	}
	template<typename _T2>
	VectorD2& operator/=(_T2 scalar) {
		*this = *this / scalar;
		return *this;
	}
	VectorD2& multPairwiseInplace(_T _x, _T _y) {
		x *= _x;
		y *= _y;
		return *this;
	}


	template<typename _T2>
	bool operator<(const VectorD2<_T2> & op) const {
		return ((y == op.y && (x < op.x))
				|| y < op.y);
	}

	template<typename _T2>
	bool operator==(const VectorD2<_T2> & op) const {
		return (x==op.x && y==op.y);
	}

	template<typename _T2>
	bool operator!=(const VectorD2<_T2> & op) const {
		return (x!=op.x || y!=op.y);
	}

	template<typename _T2>
	bool operator<=(const VectorD2<_T2> & op) const {
		return ((*this < op) || (*this == op));
	}

};

template<typename _T>
struct VectorD2__absolute_less {
	VectorD2<_T> zero;
	VectorD2__absolute_less(VectorD2<_T> z = VectorD2<_T>(0,0)) : zero(z) {}

	bool operator()(const VectorD2<_T> v1, const VectorD2<_T> v2) const {
		return (v1-zero).GetLength2() < (v2-zero).GetLength2();
	}
};


using CVec=VectorD2<float>;

template<typename _T>
class SquareMatrix {
public:
	VectorD2<_T> v1, v2;
	SquareMatrix(VectorD2<_T> _v1 = VectorD2<_T>(0,0), VectorD2<_T> _v2 = VectorD2<_T>(0,0)) {
		v1 = _v1; v2 = _v2;
	}

	static SquareMatrix Identity() {
		 return SquareMatrix(VectorD2<_T>(1,0), VectorD2<_T>(0,1));
	}

	static SquareMatrix RotateMatrix(float angle) {
		SquareMatrix m;
		m.v1.x = cosf(angle);
		m.v1.y = sinf(angle);
		m.v2.x = -m.v1.y;
		m.v2.y = m.v1.x;
		return m;
	}

	CVec operator()(const VectorD2<_T>& v) const {
		return CVec(v.x*v1.x + v.y*v2.x, v.x*v1.y + v.y*v2.y);
	}
	SquareMatrix operator*(const SquareMatrix& m) const {
		return SquareMatrix((*this)(m.v1), (*this)(m.v2));
	}
	SquareMatrix operator*(const float m) const {
		return SquareMatrix(v1*m, v2*m);
	}
	SquareMatrix operator*(const int m) const {
		return SquareMatrix(v1*m, v2*m);
	}
	SquareMatrix operator/(const float m) const {
		return SquareMatrix(v1/m, v2/m);
	}
	SquareMatrix operator/(const int m) const {
		return SquareMatrix(v1/m, v2/m);
	}
	_T det() const {
		return v1.x*v2.y - v1.y*v2.x;
	}
	SquareMatrix inverse() const {
		_T tdet = det();
		if(tdet == 0)
			return SquareMatrix();
		else
			return SquareMatrix(VectorD2<_T>(v2.y,-v1.y),VectorD2<_T>(-v2.x,v1.x))/tdet;
	}

	// v1 is the upper-left, v2 the right-bottom
	bool isInDefinedArea(const VectorD2<_T>& p) const {
		return v1.x <= p.x && p.x <= v2.x && v1.y <= p.y && p.y <= v2.y;
	}

	VectorD2<_T> getCenter() const {
		return (v1 + v2) / 2;
	}

	SquareMatrix getInsersectionWithArea(const SquareMatrix& a) const {
		return SquareMatrix(
			VectorD2<_T>( MAX(a.v1.x, v1.x), MAX(a.v1.y, v1.y) ),
			VectorD2<_T>( MIN(a.v2.x, v2.x), MIN(a.v2.y, v2.y) )
			);
	}

};


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

template<class _action>
void fastTraceLine(CVec target, CVec start, uchar checkflag, _action& checkflag_action) {
	enum { X_DOM=-1, Y_DOM=1 } dom; // which is dominating?
	CVec dir = target-start;
	if(dir.x == 0 && dir.y == 0)
		return;

	float quot;
	int s_x = (dir.x >= 0) ? 1 : -1;
	int s_y = (dir.y >= 0) ? 1 : -1;
	// ensure, that |quot| <= 1 (we swap the whole map virtuelly for this, this is, what dom saves)
	if(s_x * dir.x >= s_y * dir.y) {
		dom = X_DOM;
		quot = dir.y / dir.x;
	} else {
		dom = Y_DOM;
		quot = dir.x / dir.y;
	}

#ifdef _AI_DEBUG
	//SmartPointer<SDL_Surface> bmpDest = game.gameMap()->GetDebugImage();
#endif

	CMap* map = game.gameMap();
	if(!map || !map->isLoaded()) return;

	int map_w = map->GetWidth();
	int map_h = map->GetHeight();

	int start_x = (int)start.x;
	int start_y = (int)start.y;
	int x = 0;
	int y = 0;
	while(true) {
		if(dom != Y_DOM) { // X_DOM
			y = (int)(quot*(float)x);
		} else { // Y_DOM
			x = (int)(quot*(float)y);
		}

		// is all done?
		if(s_x*x > s_x*(int)dir.x
		   || s_y*y > s_y*(int)dir.y) {
			break;
		}

		// this is my current pos
		int pos_x = start_x + x;
		int pos_y = start_y + y;

		// clipping?
		if(pos_x < 0 || pos_x >= map_w
		   || pos_y < 0 || pos_y >= map_h) {
			if(!checkflag_action(pos_x, pos_y))
				break;
			continue;
		}

#ifdef _AI_DEBUG
		//PutPixel(bmpDest,pos_x*2,pos_y*2,Color(255,255,0));
#endif

		// is the checkflag fitting to our current flag?
		if(map->unsafeGetMaterial(pos_x,pos_y).toLxFlags() & checkflag)
			// do the given action; break if false
			if(!checkflag_action(pos_x, pos_y))
				break;

		// go ahead
		if(dom != Y_DOM) { // X_DOM
			x += s_x;
		} else { // Y_DOM
			y += s_y;
		}
	}
}
struct NEW_ai_node_t {
	float fX, fY;
	NEW_ai_node_t *psPrev, *psNext;
	NEW_ai_node_t() : fX(0), fY(0), psPrev(NULL), psNext(NULL) {}
};

SquareMatrix<int> getMaxFreeArea(VectorD2<int> p, uchar checkflag) {
	uint map_w = game.gameMap()->GetWidth();
	uint map_h = game.gameMap()->GetHeight();
	uchar** pxflags = game.gameMap()->material->line;
	boost::array<Material,256>& materials = game.gameMap()->materialArray();

	SquareMatrix<int> ret;
	ret.v1 = p; ret.v2 = p;

	// just return if we are outside
	if(p.x < 0 || (uint)p.x >= map_w
	|| p.y < 0 || (uint)p.y >= map_h)
		return ret;

	enum { GO_RIGHT=1, GO_DOWN=2, GO_LEFT=4, GO_UP=8 }; short dir;
	unsigned short col;
	int x=0, y=0;

	// loop over all directions until there is some obstacle
	col = 0; dir = 1;
	while(true) {
		if(col == 0xF) // got we collisions in all directions?
			break;

		// change direction
		do {
			dir = dir << 1;
			if(dir > 8) dir = 1;
		} while(col & dir);

		// set start pos
		switch(dir) {
		case GO_RIGHT: x=ret.v2.x+1; y=ret.v1.y; break;
		case GO_DOWN: x=ret.v1.x; y=ret.v2.y+1; break;
		case GO_LEFT: x=ret.v1.x-1; y=ret.v1.y; break;
		case GO_UP: x=ret.v1.x; y=ret.v1.y-1; break;
		}

		// check if still inside the map (than nothing bad can happen)
		if(x < 0 || (uint)x >= map_w
		|| y < 0 || (uint)y >= map_h) {
			col |= dir;
			continue;
		}

		// loop over all pxflags of the aligned line and check for an obstacle
		while(true) {
			// break if ready
			if(dir == GO_RIGHT || dir == GO_LEFT) {
				if(y > ret.v2.y) break;
			} else // GO_UP / GO_DOWN
				if(x > ret.v2.x) break;

			// is there some obstacle?
			if(materials[pxflags[y][x]].toLxFlags() & checkflag) {
				col |= dir;
				break;
			}

			// inc the pos (trace the aligned line)
			switch(dir) {
			case GO_RIGHT: case GO_LEFT: y++; break;
			case GO_DOWN: case GO_UP: x++; break;
			}
		}

		if(!(col & dir)) {
			// simple inc 1 pixel in the checked direction
			switch(dir) {
			case GO_RIGHT: ret.v2.x++; break;
			case GO_DOWN: ret.v2.y++; break;
			case GO_LEFT: ret.v1.x--; break;
			case GO_UP: ret.v1.y--; break;
			}
		}

	} // loop over directions

	// cut the area if outer space...
	if(ret.v1.x < 0) ret.v1.x = 0;
	if(ret.v1.y < 0) ret.v1.y = 0;
	if((uint)ret.v2.x >= map_w) ret.v2.x = map_w-1;
	if((uint)ret.v2.y >= map_h) ret.v2.y = map_h-1;

	return ret;
}
NEW_ai_node_t* createNewAiNode(float x, float y, NEW_ai_node_t* next = NULL, NEW_ai_node_t* prev = NULL) {
	NEW_ai_node_t* tmp = new NEW_ai_node_t;
	tmp->fX = x; tmp->fY = y;
	tmp->psNext = next; tmp->psPrev = prev;
	return tmp;
}
NEW_ai_node_t* createNewAiNode(NEW_ai_node_t* base) {
	if(!base) return NULL;
	NEW_ai_node_t* tmp = new NEW_ai_node_t;
	tmp->fX = base->fX; tmp->fY = base->fY;
	tmp->psNext = base->psNext; tmp->psPrev = base->psPrev;
	return tmp;
}
NEW_ai_node_t* createNewAiNode(const VectorD2<int>& p) {
	return createNewAiNode((float)p.x, (float)p.y);
}
INLINE bool simpleTraceLine(VectorD2<int> start, VectorD2<int> dist, uchar checkflag) {
	boost::array<Material,256>& materials = game.gameMap()->materialArray();
	unsigned char** pxflags = game.gameMap()->material->line;
	if (!pxflags)  {  // The map has been probably shut down
		warnings << "simpleTraceLine with pxflags==NULL" << endl;
		return false;
	}
	uint map_w = game.gameMap()->GetWidth();
	uint map_h = game.gameMap()->GetHeight();

	if(abs(dist.x) >= abs(dist.y)) {
		if(dist.x < 0) { // avoid anoying checks
			start.x += dist.x;
			dist.x = -dist.x;
		}
		if(start.x < 0 || (uint)(start.x + dist.x) >= map_w || start.y < 0 || (uint)start.y >= map_h)
			return false;
		for(int x = 0; x <= dist.x; x++) {
			if(materials[pxflags[start.y][start.x + x]].toLxFlags() & checkflag)
				return false;
		}
	} else { // y is greater
		if(dist.y < 0) { // avoid anoying checks
			start.y += dist.y;
			dist.y = -dist.y;
		}
		if(start.y < 0 || (uint)(start.y + dist.y) >= map_h || start.x < 0 || (uint)start.x >= map_w)
			return false;
		for(int y = 0; y <= dist.y; y++) {
			if(materials[pxflags[start.y+y][start.x]].toLxFlags() & checkflag)
				return false;
		}
	}
	return true;
}
class set_col_and_break {
public:
	CVec start;
	CVec* collision;
	bool hit;

	set_col_and_break(CVec st, CVec* col) : start(st), collision(col), hit(false) {}
	bool operator()(int x, int y) {
		hit = true;
		if(collision && (*collision - start).GetLength2() > (CVec((float)x,(float)y) - start).GetLength2()) {
			collision->x = (float)x;
			collision->y = (float)y;
		}
		return false;
	}
};
int traceWormLine(CVec target, CVec start, CVec* collision)
{
	// At least three, else it goes through walls in jukke
	static const unsigned short wormsize = 3;

	if(collision) {
		collision->x = target.x;
		collision->y = target.y;
	}

	CVec dir = CVec(target.y-start.y,start.x-target.x); // rotate clockwise by 90 deg
	NormalizeVector(&dir);
	set_col_and_break action = set_col_and_break(start - dir*(wormsize-1)/2, collision);
	target -= dir*(wormsize-1)/2;
	for(unsigned short i = 0; i < wormsize; i++, action.start += dir, target += dir)
		fastTraceLine(target, action.start, (uchar)PX_ROCK, action);

	return !action.hit;

}
int coarseTrace(CVec target, CVec start, int *nType, int divs, uchar checkflag)
{
    if( game.gameMap() == NULL ) {
		errors << "CWorm::traceLine: map unset" << endl;
		return 0;
	}

    // Trace a line from the worm to length or until it hits something
	CVec pos = start;
	CVec dir = target-pos;
    int nTotalLength = (int)NormalizeVector(&dir);

	int divisions = divs;			// How many pixels we go through each check (more = slower)

	if( nTotalLength < divisions)
		divisions = nTotalLength;

	if (nType)
		*nType = PX_EMPTY;

	// Make sure we have at least 1 division
	divisions = MAX(divisions,1);

	int i;
	for(i=0; i<nTotalLength; i+=divisions) {
		uchar px = game.gameMap()->GetPixelFlag( (int)pos.x, (int)pos.y );
		//game.gameMap()->PutImagePixel((int)pos.x, (int)pos.y, Color(255,0,0));

        if(!(px & checkflag)) {
			if (nType)
				*nType = px;
            return i;
        }

        pos = pos + dir * (float)divisions;
    }

    return nTotalLength;
}
class searchpath_base {
public:

// this will define, if we should break the search on the first result
// (we ensure in forEachChecklistItem, that it is not that bad)
#define		BREAK_ON_FIRST	1

	// this is one node in the map
	class area_item {
	public:

		// needed for area_set (for area search function getArea(p))
		struct area_v1__less {
			// this is a well-defined transitive ordering after the v1-vector of the matrix
			bool operator()(const area_item* a, const area_item* b) const {
				if(!a || !b) return a < b; // this should never happen
				return a->area.v1 < b->area.v1;
			}
		};

		// needed for area_set (for area search function getBestArea)
		struct expected_min_total_dist__less {
			// this is a well-defined transitive ordering after the v1-vector of the matrix
			bool operator()(const area_item* a, const area_item* b) const {
				if(!a || !b) return a < b; // this should never happen
				double dista = a->expected_min_total_dist();
				double distb = b->expected_min_total_dist();
				// In some rare cases (depending on optimisation and hardware, (a<b)&&(b<a) is true here.
				// To make it a valid order, we have to make the additional check.
				if(fabs(dista - distb) < 0.0001) return false;
				return dista < distb;
			}
		};

		searchpath_base* const base;

		// this will save the state, if we still have to check a specific end
		// at the rectangle or not
		short checklistRows;
		short checklistRowStart;
		short checklistRowHeight;
		short checklistCols;
		short checklistColStart;
		short checklistColWidth;

		const SquareMatrix<int> area;
		area_item* lastArea; // the area where we came from
		double dist_from_source; // distance from startpoint

		void initChecklists() {
			VectorD2<int> size = area.v2 - area.v1;
			// ensure here, that the starts are not 0
			checklistCols = (size.x-3) / checklistColWidth + 1;
			checklistRows = (size.y-3) / checklistRowHeight + 1;
			checklistColStart = (size.x - (checklistCols-1)*checklistColWidth) / 2;
			checklistRowStart = (size.y - (checklistRows-1)*checklistRowHeight) / 2;
		}

		// expected minimum total distance from startpoint to destination
		double expected_min_total_dist() const {
			return dist_from_source + (area.getCenter() - base->target).GetLength();
		}

		double expected_min_total_dist(area_item* lastArea) const {
			return lastArea->dist_from_source + getDistToArea(lastArea) + (area.getCenter() - base->target).GetLength();
		}

		void setLastArea(area_item* theValue) {
			lastArea = theValue;
			if(lastArea == NULL)
				dist_from_source = 0;
			else
				dist_from_source = lastArea->dist_from_source + getDistToArea(lastArea);
		}

		VectorD2<int> getConnectorPointForArea(area_item* otherArea) const {
			if(otherArea == NULL) return area.getCenter();

			SquareMatrix<int> intersection = area.getInsersectionWithArea(otherArea->area);
			return intersection.getCenter();
			/*
			VectorD2<int> otherCenter = otherArea->area.getCenter();
			if(area.v1.x <= otherCenter.x && otherCenter.x <= area.v2.x)
				return VectorD2<int>(otherCenter.x, area.getCenter().y);
			else
				return VectorD2<int>(area.getCenter().x, otherCenter.y); */
		}

		double getDistToArea(area_item* otherArea) const {
			VectorD2<int> conPoint = getConnectorPointForArea(otherArea);
			return
				(otherArea->area.getCenter() - conPoint).GetLength() +
				(area.getCenter() - conPoint).GetLength();
		}

		area_item(searchpath_base* b, const SquareMatrix<int>& a) :
			base(b),
			checklistRows(0),
			checklistRowStart(0),
			checklistRowHeight(5),
			checklistCols(0),
			checklistColStart(0),
			checklistColWidth(5),
			area(a),
			lastArea(NULL),
			dist_from_source(0) {}

		// iterates over all checklist points
		// calls given action with 2 parameters:
		//    VectorD2<int> p, VectorD2<int> dist
		// p is the point inside of the area, dist the change to the target (p+dist is therefore the new position)
		// if the returned value by the action is false, it will break
		template<typename _action>
		void forEachChecklistItem(_action action) {
			int i;
			VectorD2<int> p, dist;

			// TODO: this sorting is not needed anymore here
			typedef std::multiset< VectorD2<int>, VectorD2__absolute_less<int> > p_set;
			// the set point here defines, where the 'best' point is (the sorting depends on it)
			p_set points(VectorD2__absolute_less<int>( base->target )); // + getCenter()*2 - start) / 2));

			// insert now the points to the list
			// the list will sort itself

			// left
			p.x = area.v1.x;
			dist.x = -checklistRowHeight; dist.y = 0;
			for(i = 0; i < checklistRows; i++) {
				p.y = area.v1.y + checklistRowStart + i*checklistRowHeight;
				points.insert(p);
			}

			// right
			p.x = area.v2.x;
			dist.x = checklistRowHeight; dist.y = 0;
			for(i = 0; i < checklistRows; i++) {
				p.y = area.v1.y + checklistRowStart + i*checklistRowHeight;
				points.insert(p);
			}

			// top
			p.y = area.v1.y;
			dist.x = 0; dist.y = -checklistColWidth;
			for(i = 0; i < checklistCols; i++) {
				p.x = area.v1.x + checklistColStart + i*checklistColWidth;
				points.insert(p);
			}

			// bottom
			p.y = area.v2.y;
			dist.x = 0; dist.y = checklistColWidth;
			for(i = 0; i < checklistCols; i++) {
				p.x = area.v1.x + checklistColStart + i*checklistColWidth;
				points.insert(p);
			}

			// the list is sorted, the closest (to the target) comes first
			for(p_set::iterator it = points.begin(); it != points.end(); it++) {
				if(it->x == area.v1.x) { // left
					dist.x = -checklistRowHeight; dist.y = 0;
				} else if(it->x == area.v2.x) { // right
					dist.x = checklistRowHeight; dist.y = 0;
				} else if(it->y == area.v1.y) { // top
					dist.x = 0; dist.y = -checklistColWidth;
				} else { // bottom
					dist.x = 0; dist.y = checklistColWidth;
				}
				if(!action(*it, dist)) return;
			}

		}

		class check_checkpoint {
		public:
			searchpath_base* base;
			area_item* myArea;
			float bestNodeLen; // this can be done better...

			check_checkpoint(searchpath_base* b, area_item* a) :
				base(b),
				myArea(a),
				bestNodeLen(-1) {}

			// this will be called by forEachChecklistItem
			// pt is the checkpoint and dist the change to the new target (it means we want from pt to pt+dist)
			// it will search for the best node starting at the specific pos
			bool operator() (VectorD2<int> pt, VectorD2<int> dist) {
				bool trace = true;
				VectorD2<int> dir, start;
				unsigned short left, right;
				if(abs(dist.x) >= abs(dist.y))
					dir.y = 1;
				else
					dir.x = 1;
				start = pt;
				pt += dir;

				// ensure, that the way has at least the width of wormsize
				game.gameMap()->lockFlags(false);
				trace = simpleTraceLine(pt, dist, PX_ROCK);
				for(left = 0; trace && left < wormsize; pt += dir) {
					trace = simpleTraceLine(pt, dist, PX_ROCK);
					if(trace) left++;
				}
				pt = start - dir; trace = true;
				for(right = 0; trace && right < (wormsize-left); pt -= dir) {
					trace = simpleTraceLine(pt, dist, PX_ROCK);
					if(trace) right++;
				}
				game.gameMap()->unlockFlags(false);

				// is there enough space?
				if(left+right >= wormsize) {
					base->addAreaNode( pt + dist, myArea );
				}

				// continue the search
				return true;
			}
		}; // class check_checkpoint

		void process() {
			// add all successor-nodes to areas_stack
			forEachChecklistItem( check_checkpoint(base, this) );
		}

	}; // class area_item

	// area_set keeps track about all available areas. because there can be areas with the same area_v1, this must be a multiset.
	typedef std::multiset< area_item*, area_item::area_v1__less > area_set;
	// area_stack_set is the dynamic stack in the pathfinding algo
	typedef std::set< area_item*, area_item::expected_min_total_dist__less > area_stack_set;
	typedef std::set< NEW_ai_node_t* > node_set;

	// these neccessary attributes have to be set manually
	area_set areas; // set of all created areas
	node_set nodes; // set of all created nodes
	VectorD2<int> start, target;

	area_stack_set areas_stack; // set of areas used by the searching algorithm

searchpath_base() {}

~searchpath_base() { clear(); }

	void removePathFromList(NEW_ai_node_t* start) {
		for(NEW_ai_node_t* node = start; node; node = node->psNext)
			nodes.erase(node);
	}

private:
	void clear() {
		clear_areas();
		clear_nodes();
	}

	void clear_areas() {
		for(area_set::iterator it = areas.begin(); it != areas.end(); it++) {
			delete *it;
		}
		areas.clear();
	}

	void clear_nodes() {
		for(node_set::iterator it = nodes.begin(); it != nodes.end(); it++) {
			delete *it;
		}
		nodes.clear();
	}

	// searches for an overleading area and returns the first
	// returns NULL, if none found
	area_item* getArea(VectorD2<int> p) {
		// TODO: area_v1__less is not used here
		// (take a look at pseudoless)
		for(area_set::iterator it = areas.begin(); it != areas.end() && (*it)->area.v1 <= p; it++) {
			if((*it)->area.isInDefinedArea(p))
				return *it;
		}

#ifdef _AI_DEBUG
/*		printf("getArea( %i, %i )\n", p.x, p.y);
		printf("  don't find an underlying area\n");
		printf("  areas = {\n");
		for(area_set::iterator it = areas.begin(); it != areas.end(); it++) {
			printf("		( %i, %i, %i, %i )%s,\n",
				(*it)->area.v1.x, (*it)->area.v1.y,
				(*it)->area.v2.x, (*it)->area.v2.y,
				((*it)->area.v1 <= p) ? "" : " (*)");
		}
		printf("     }\n"); */
#endif

		return NULL;
	}

	area_item* getBestArea() {
		// areas_stack is sorted and we have the best solution at the beginning
		area_stack_set::iterator it = areas_stack.begin();
		if(it == areas_stack.end()) return NULL;
		return *it;
	}

	NEW_ai_node_t* buildPath(area_item* lastArea) {
		NEW_ai_node_t* last_node = createNewAiNode(target);
		nodes.insert(last_node);
		area_item* a = lastArea;

		while(a != NULL) {
			NEW_ai_node_t* node = createNewAiNode(a->area.getCenter());
			node->psNext = last_node;
			last_node->psPrev = node;
			nodes.insert(node);
			last_node = node;

			node = createNewAiNode(a->getConnectorPointForArea(a->lastArea));
			node->psNext = last_node;
			last_node->psPrev = node;
			nodes.insert(node);
			last_node = node;

			a = a->lastArea;
		}

		return last_node;
	}

	// it searches for the path (dynamic algo, sort of A*)
	NEW_ai_node_t* findPath(VectorD2<int> start) {
		areas_stack.clear();
		addAreaNode(start, NULL);

		while(areas_stack.size() > 0) {

			area_item* a = getBestArea();
			areas_stack.erase(a);

			// can we just finish with the search?
			game.gameMap()->lockFlags(false);
			if(traceWormLine(target, a->area.getCenter())) {
				game.gameMap()->unlockFlags(false);
				// yippieh!
				return buildPath(a);
			}
			game.gameMap()->unlockFlags(false);

			a->process();
		}

		return NULL;
	}

public:

	// add new area as a node to path
	// start is location (so an area surrounding start is searched)
	void addAreaNode(VectorD2<int> start, area_item* lastArea) {

		// is the start inside of the map?
		if(start.x < 0 || (uint)start.x >= game.gameMap()->GetWidth()
		|| start.y < 0 || (uint)start.y >= game.gameMap()->GetHeight())
			return;

		// look around for an existing area here
		area_item* a = getArea(start);
		if(a) { // we found an area which includes this point
			if(a->expected_min_total_dist() > a->expected_min_total_dist(lastArea)) {
				areas_stack.erase(a);
				a->setLastArea(lastArea);
				areas_stack.insert(a);
			}
			return;
		}

		// get the max area (rectangle) around us
		game.gameMap()->lockFlags(false);
		SquareMatrix<int> area = getMaxFreeArea(start, PX_ROCK);
		game.gameMap()->unlockFlags(false);
		// add only if area is big enough
		if(area.v2.x-area.v1.x >= wormsize && area.v2.y-area.v1.y >= wormsize) {
			a = new area_item(this, area);
			a->initChecklists();
			a->setLastArea(lastArea);
			areas.insert(a);
			areas_stack.insert(a);
			// and search
		}
	}

void completeNodesInfo(NEW_ai_node_t* start) {
		NEW_ai_node_t* last = NULL;
		for(NEW_ai_node_t* n = start; n; n = n->psNext) {
			n->psPrev = last;
			last = n;
		}
	}
void splitUpNodes(NEW_ai_node_t* start, NEW_ai_node_t* end) {
		NEW_ai_node_t* tmpnode = NULL;
		short s1, s2;
		static const unsigned short dist = 50;
		for(NEW_ai_node_t* n = start; n && n->psNext && n != end; n = n->psNext) {
			s1 = (n->fX > n->psNext->fX) ? 1 : -1;
			s2 = (n->fY > n->psNext->fY) ? 1 : -1;
			if(s1*(n->fX - n->psNext->fX) > dist || s2*(n->fY - n->psNext->fY) > dist) {
				tmpnode = new NEW_ai_node_t;
				if(tmpnode) {
					nodes.insert(tmpnode);
					if(s1*(n->fX - n->psNext->fX) >= s2*(n->fY - n->psNext->fY)) {
						tmpnode->fX = n->fX - s1*dist;
						tmpnode->fY = n->fY
							- s1*dist*(n->fY - n->psNext->fY)/(n->fX - n->psNext->fX);
					} else {
						tmpnode->fY = n->fY - s2*dist;
						tmpnode->fX = n->fX
							- s2*dist*(n->fX - n->psNext->fX)/(n->fY - n->psNext->fY);
					}
					tmpnode->psNext = n->psNext;
					tmpnode->psPrev = n;
					n->psNext->psPrev = tmpnode;
					n->psNext = tmpnode;
				}
			}
		}
	}
void simplifyPath(NEW_ai_node_t* start) {
		NEW_ai_node_t* node = NULL;
		NEW_ai_node_t* last_node = NULL;
		NEW_ai_node_t* closest_node = NULL;
		unsigned short count = 0;
		float dist, len;

		// short up
		for(node = start; node; node = node->psNext)  {
			len = 0;
			last_node = node;
			for(closest_node = node, count = 0; closest_node; closest_node = closest_node->psNext, count++) {
				len += CVec(closest_node->fX - last_node->fX, closest_node->fY - last_node->fY).GetLength2();
				dist = CVec(closest_node->fX - node->fX, closest_node->fY - node->fY).GetLength2();
				if(count >= 3
				&& dist < len
				&& traceWormLine(CVec(closest_node->fX,closest_node->fY),CVec(node->fX,node->fY))) {
					node->psNext = closest_node;
					closest_node->psPrev = node;
					len = dist;
				}
				last_node = closest_node;
			}
		}

		// simplify
		for(node = start; node; node = node->psNext) {
			// While we see the two nodes, delete all nodes between them and skip to next node
			count = 0;
			while (closest_node && traceWormLine(CVec(closest_node->fX,closest_node->fY),CVec(node->fX,node->fY)))  {
				if(count >= 2) {
					node->psNext = closest_node;
					closest_node->psPrev = node;
				}
				closest_node = closest_node->psNext;
				count++;
			}
		}
	}

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
 return 0;
}
